import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { copy, plain, requireCondition, validId } from "./store.mjs";
const textOf = (event) =>
  event?.data.message?.content
    ?.filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n") ?? "";
const modelReply = (history) =>
  history.events
    .filter(
      (event) =>
        event.type === "assistant/message" &&
        !event.data.interrupted &&
        textOf(event),
    )
    .at(-1);

/** Bounded native member turns, with durable material and membership generations. */
export class GroupMeetingController {
  #runs = new Map();
  #closed = false;
  constructor({ store, policy, adapter, tasks }) {
    Object.assign(this, { store, policy, adapter, tasks });
  }
  #human(actor) {
    this.policy.actorKey(actor);
    requireCondition(actor.kind === "human", "access_denied");
  }
  #members(ids, coordinator, state) {
    requireCondition(
      Array.isArray(ids) &&
        ids.length >= 1 &&
        ids.length <= 15 &&
        new Set(ids).size === ids.length &&
        ids.every(
          (id) => validId(id) && state.bots[id]?.lifecycle === "active",
        ) &&
        ids.includes(coordinator),
      "invalid_members",
    );
  }
  #input(command, keys) {
    command = copy(command);
    requireCondition(
      plain(command.input) &&
        Object.keys(command.input).every((key) => keys.includes(key)),
      "invalid_command",
    );
    return command;
  }
  async createGroup(actor, command) {
    this.#human(actor);
    command = this.#input(command, [
      "name",
      "botIds",
      "coordinatorBotId",
      "rounds",
      "maxRequests",
    ]);
    const input = command.input;
    requireCondition(
      typeof input.name === "string" &&
        input.name.trim().length > 0 &&
        input.name.length <= 100 &&
        Number.isSafeInteger(input.rounds ?? 1) &&
        (input.rounds ?? 1) >= 1 &&
        (input.rounds ?? 1) <= 3 &&
        Number.isSafeInteger(input.maxRequests ?? 12) &&
        (input.maxRequests ?? 12) >= 1 &&
        (input.maxRequests ?? 12) <= 60,
      "invalid_group",
    );
    return this.store.transact(this.policy.command(actor, command), (draft) => {
      this.#members(input.botIds, input.coordinatorBotId, draft);
      const groupId = `group_${randomUUID()}`;
      const group = {
        groupId,
        name: input.name.trim(),
        ownerBotId: input.coordinatorBotId,
        coordinatorBotId: input.coordinatorBotId,
        version: 1,
        epoch: 1,
        members: input.botIds.map((botId) => ({
          botId,
          active: true,
          epoch: 1,
        })),
        messages: [],
        rounds: {},
        roundLimit: input.rounds ?? 1,
        maxRequests: input.maxRequests ?? 12,
      };
      draft.groups[groupId] = group;
      return group;
    });
  }
  async post(actor, command) {
    requireCondition(!this.#closed, "disabled");
    command = this.#input(command, ["groupId", "text"]);
    const input = command.input;
    requireCondition(
      typeof input.text === "string" &&
        input.text.trim().length > 0 &&
        input.text.length <= 16000,
      "invalid_message",
    );
    const intent = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const group = draft.groups[input.groupId];
        requireCondition(group, "not_found");
        this.policy.require(
          actor,
          "group.post",
          { kind: "group", id: group.groupId },
          draft,
        );
        if (actor.kind === "bot")
          requireCondition(
            draft.sessions[actor.sessionId].purpose !== "independent",
            "sealed_channel",
          );
        requireCondition(group.messages.length < 2000, "group_history_full");
        const message = {
          messageId: `message_${randomUUID()}`,
          groupId: group.groupId,
          text: input.text,
          producer:
            actor.kind === "human"
              ? { kind: "human" }
              : { kind: "bot", botId: actor.botId, sessionId: actor.sessionId },
          operationId: command.operationId,
          origins: this.policy.readDependencies(actor),
          time: new Date().toISOString(),
        };
        group.messages.push(message);
        group.version++;
        if (actor.kind === "bot")
          return {
            groupId: group.groupId,
            messageId: message.messageId,
            roundId: null,
          };
        requireCondition(
          Object.values(group.rounds).filter((row) =>
            ["running", "UNKNOWN"].includes(row.state),
          ).length < 8,
          "group_queue_full",
        );
        const roundId = `round_${randomUUID()}`,
          round = {
            roundId,
            groupId: group.groupId,
            state: "running",
            runtimeId: this.tasks.runtimeId,
            causeMessageId: message.messageId,
            roundLimit: group.roundLimit,
            maxRequests: group.maxRequests,
            requests: 0,
            channels: [],
            absences: [],
          };
        group.rounds[roundId] = round;
        return {
          groupId: group.groupId,
          messageId: message.messageId,
          roundId,
        };
      },
    );
    if (
      intent.roundId &&
      this.store.read().groups[intent.groupId].rounds[intent.roundId].state ===
        "running" &&
      this.store.read().groups[intent.groupId].rounds[intent.roundId]
        .runtimeId === this.tasks.runtimeId
    )
      this.#schedule(`group:${intent.roundId}`, () => this.#groupRound(intent));
    return intent;
  }
  #binding(draft, botId, purpose, lineage) {
    const bot = draft.bots[botId],
      sessionId = randomUUID();
    requireCondition(bot?.lifecycle === "active", "bot_not_active");
    const binding = {
      sessionId,
      botId,
      purpose,
      epoch: lineage.epoch ?? 1,
      model: copy(bot.contact),
      configRevision: bot.configRevision,
      cwd: bot.cwd,
      presetId: bot.presetId,
      state: "creating",
      ownerRuntimeId: this.adapter.runtimeId,
      archived: false,
      origins: [],
      requestLimit: 2,
      lineage: { ...copy(lineage), sessionId, botId },
    };
    draft.sessions[sessionId] = binding;
    return binding;
  }
  #schedule(key, operation) {
    if (this.#runs.has(key) || this.#closed) return;
    const promise = this.adapter.context.agents
      .withoutInitiator(operation)
      .catch(() => {})
      .finally(() => this.#runs.delete(key));
    this.#runs.set(key, promise);
  }
  async #turn(binding, prompt) {
    requireCondition(!this.#closed, "disabled");
    const handle = await this.adapter.createOwned(binding);
    await this.store.transact(
      {
        operationId: `${binding.sessionId}:ready`,
        action: "collaboration.ready",
        input: { sessionId: binding.sessionId },
      },
      (draft) => {
        const current = draft.sessions[binding.sessionId];
        requireCondition(current.state === "creating", "stale_channel");
        current.state = "ready";
        return null;
      },
    );
    const actor = this.policy.fromAgent(handle.agent),
      body = typeof prompt === "function" ? prompt(actor) : prompt,
      origins = this.policy.readDependencies(actor);
    await this.store.transact(
      {
        operationId: `${binding.sessionId}:prompt-origins`,
        action: "collaboration.prompt-origins",
        input: { sessionId: binding.sessionId, origins },
      },
      (draft) => {
        for (const ref of origins)
          this.policy.require(actor, `${ref.kind}.read`, ref, draft);
        draft.sessions[binding.sessionId].origins = origins;
        return null;
      },
    );
    for (const ref of origins)
      this.policy.require(actor, `${ref.kind}.read`, ref);
    handle.agent.followup(
      createUserMessage({
        id: randomUUID(),
        content: [{ type: "text", text: body }],
        source: {
          kind: "dsh-bot-collaboration",
          sessionId: binding.sessionId,
          ...copy(binding.lineage),
        },
      }),
    );
    await handle.agent.whenIdle();
    const resources = this.adapter.resources(binding.sessionId);
    requireCondition(resources.settled, "resource_unsettled");
    await this.adapter.context.sessions.flush(handle.agent.session);
    const history = await this.adapter.readNative(binding.sessionId),
      end = history.events.filter((event) => event.type === "turn/end").at(-1),
      reply = modelReply(history);
    requireCondition(
      end?.data.reason.kind === "completed" && reply,
      "model_opinion_missing",
    );
    return {
      handle,
      reply,
      text: textOf(reply),
      requests: resources.requests.length,
      usage: resources.requests.map((row) => row.usage),
    };
  }
  async #finishChannel(sessionId, error = null) {
    await this.store
      .transact(
        {
          operationId: `${sessionId}:finish`,
          action: "collaboration.channel-settled",
          input: { sessionId, error },
        },
        (draft) => {
          const row = draft.sessions[sessionId];
          if (row) row.state = error ? "UNKNOWN" : "settled";
          return null;
        },
      )
      .catch(() => {});
    await this.adapter.disposeOwned(sessionId);
  }
  async #groupRound(intent) {
    const original = this.store.read().groups[intent.groupId],
      round = original.rounds[intent.roundId];
    for (let cycle = 0; cycle < round.roundLimit && !this.#closed; cycle++)
      for (const member of original.members.filter((row) => row.active)) {
        const current = this.store.read().groups[intent.groupId];
        if (current.rounds[intent.roundId].state !== "running") return;
        if (current.rounds[intent.roundId].requests >= round.maxRequests) break;
        let binding,
          error = null;
        try {
          binding = await this.store.transact(
            {
              operationId: randomUUID(),
              action: "group.channel",
              input: { roundId: intent.roundId, botId: member.botId, cycle },
            },
            (draft) => {
              const group = draft.groups[intent.groupId];
              requireCondition(
                group.members.some(
                  (row) =>
                    row.botId === member.botId &&
                    row.active &&
                    row.epoch === member.epoch,
                ),
                "stale_member",
              );
              const binding = this.#binding(draft, member.botId, "group", {
                groupId: group.groupId,
                roundId: intent.roundId,
                memberEpoch: member.epoch,
              });
              group.rounds[intent.roundId].channels.push(binding.sessionId);
              binding.requestLimit = Math.min(
                2,
                round.maxRequests - group.rounds[intent.roundId].requests,
              );
              return binding;
            },
          );
          const result = await this.#turn(binding, (actor) => {
            const transcript = this.viewGroup(
              actor,
              this.store.read().groups[intent.groupId],
            ).messages.slice(-30);
            return `内部群 ${current.name}，群身份 ${current.groupId}，有界轮 ${intent.roundId}/${cycle + 1}。\n仅讨论本群材料：${JSON.stringify(transcript)}\n请直接给出自己的简短真实答复；勿自动循环转投，不改变权限。`;
          });
          await this.store.transact(
            {
              operationId: `${binding.sessionId}:reply`,
              action: "group.reply",
              input: {
                sessionId: binding.sessionId,
                eventSeq: result.reply.seq,
              },
            },
            (draft) => {
              const group = draft.groups[intent.groupId],
                memberNow = group.members.find(
                  (row) => row.botId === member.botId,
                );
              requireCondition(
                memberNow?.active && memberNow.epoch === member.epoch,
                "stale_member",
              );
              group.messages.push({
                messageId: result.reply.data.message.id,
                groupId: group.groupId,
                roundId: intent.roundId,
                text: result.text,
                producer: {
                  kind: "bot",
                  botId: member.botId,
                  sessionId: binding.sessionId,
                },
                source: {
                  sessionId: binding.sessionId,
                  eventSeq: result.reply.seq,
                },
                origins: copy(draft.sessions[binding.sessionId].origins ?? []),
                usage: result.usage,
              });
              return null;
            },
          );
        } catch (e) {
          error = e.code ?? e.name;
          await this.store
            .transact(
              {
                operationId: randomUUID(),
                action: "group.absence",
                input: { roundId: intent.roundId, botId: member.botId, error },
              },
              (draft) => {
                draft.groups[intent.groupId].rounds[
                  intent.roundId
                ].absences.push({ botId: member.botId, reason: error });
                return null;
              },
            )
            .catch(() => {});
        } finally {
          if (binding) await this.#finishChannel(binding.sessionId, error);
        }
      }
    await this.store.transact(
      {
        operationId: `${intent.roundId}:complete`,
        action: "group.round-complete",
        input: { roundId: intent.roundId },
      },
      (draft) => {
        draft.groups[intent.groupId].rounds[intent.roundId].state = "complete";
        return null;
      },
    );
  }
  #newParticipants(draft, meeting, phase) {
    meeting.runtimeId = this.tasks.runtimeId;
    meeting.runtimeState = "running";
    const group = draft.groups[meeting.groupId],
      channels = [];
    for (const participant of meeting.participants.filter(
      (row) =>
        row.active &&
        (phase !== "decision" || row.botId === meeting.coordinatorBotId),
    )) {
      const member = group.members.find(
        (row) => row.botId === participant.botId,
      );
      requireCondition(member?.active, "stale_member");
      participant.memberEpoch = member.epoch;
      const binding = this.#binding(
        draft,
        participant.botId,
        phase === "independent" ? "independent" : "meeting",
        {
          meetingId: meeting.meetingId,
          groupId: meeting.groupId,
          epoch: meeting.epoch,
          phase,
          memberEpoch: member.epoch,
        },
      );
      participant.sessionId = binding.sessionId;
      channels.push(binding.sessionId);
    }
    return channels;
  }
  async startMeeting(actor, command) {
    this.#human(actor);
    requireCondition(!this.#closed, "disabled");
    command = this.#input(command, [
      "groupId",
      "topic",
      "materials",
      "maxRequests",
    ]);
    const input = command.input;
    requireCondition(
      typeof input.topic === "string" &&
        input.topic.trim().length > 0 &&
        input.topic.length <= 1000 &&
        typeof input.materials === "string" &&
        input.materials.length <= 32000 &&
        Number.isSafeInteger(input.maxRequests ?? 30) &&
        (input.maxRequests ?? 30) >= 1 &&
        (input.maxRequests ?? 30) <= 120,
      "invalid_meeting",
    );
    const meeting = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const group = draft.groups[input.groupId];
        requireCondition(group, "not_found");
        requireCondition(
          Object.values(draft.meetings).filter(
            (row) =>
              row.groupId === group.groupId &&
              !["complete", "cancelled"].includes(row.phase),
          ).length < 8,
          "meeting_queue_full",
        );
        const meetingId = `meeting_${randomUUID()}`,
          meeting = {
            meetingId,
            groupId: group.groupId,
            ownerBotId: group.coordinatorBotId,
            coordinatorBotId: group.coordinatorBotId,
            topic: input.topic,
            materials: input.materials,
            epoch: 1,
            topicEpoch: 1,
            phase: "independent",
            participants: group.members
              .filter((row) => row.active)
              .map((row) => ({
                botId: row.botId,
                active: true,
                memberEpoch: row.epoch,
              })),
            opinions: {},
            discussion: {},
            decision: null,
            absences: {},
            history: [],
            actions: [],
            requests: 0,
            maxRequests: input.maxRequests ?? 30,
          };
        draft.meetings[meetingId] = meeting;
        this.#newParticipants(draft, meeting, "independent");
        return meeting;
      },
    );
    this.#launchMeeting(meeting.meetingId);
    return meeting;
  }
  #launchMeeting(meetingId, onlyBotId = null) {
    const meeting = this.store.read().meetings[meetingId];
    if (
      !meeting ||
      meeting.runtimeId !== this.tasks.runtimeId ||
      !["independent", "discussion", "decision"].includes(meeting.phase)
    )
      return;
    const participants = meeting.participants.filter(
      (row) =>
        row.active &&
        (!onlyBotId || row.botId === onlyBotId) &&
        (meeting.phase !== "decision" ||
          row.botId === meeting.coordinatorBotId),
    );
    for (const participant of participants) {
      const binding = this.store.read().sessions[participant.sessionId];
      if (binding?.state === "creating")
        this.#schedule(`meeting:${binding.sessionId}`, () =>
          this.#meetingTurn(meetingId, participant.botId, binding),
        );
    }
  }
  async #meetingTurn(meetingId, botId, binding) {
    let error = null;
    try {
      const meeting = this.store.read().meetings[meetingId],
        phase = binding.lineage.phase;
      const result = await this.#turn(binding, (actor) => {
        const view = this.viewMeeting(actor, meeting),
          shared =
            phase === "independent"
              ? {}
              : {
                  opinions: view.opinions,
                  ...(phase === "decision"
                    ? { discussion: view.discussion }
                    : {}),
                };
        return `会议 ${meetingId}，世代 ${binding.lineage.epoch}，阶段 ${phase}。\n议题：${meeting.topic}\n本场冻结材料：${meeting.materials}\n${JSON.stringify(shared)}\n${phase === "independent" ? "请独立思考，只直接回复你的意见。封存期间不可查询、预加载或转投其他意见，勿调用 meeting.opinion；插件会自动记录原始答复。" : phase === "discussion" ? "请基于已揭示的有效意见作简短讨论。" : "请作明确决定，说明理由、负责人建议及可验收行动项。"}\n不要创建无限群回环。`;
      });
      const actor = this.policy.fromAgent(result.handle.agent);
      await this.submitOpinion(actor, {
        operationId: `${binding.sessionId}:opinion`,
        action: "meeting.opinion",
        input: {
          meetingId,
          epoch: binding.lineage.epoch,
          memberEpoch: binding.lineage.memberEpoch,
          text: result.text,
          source: { sessionId: binding.sessionId, eventSeq: result.reply.seq },
        },
      });
    } catch (e) {
      error = e.code ?? e.name;
      await this.store
        .transact(
          {
            operationId: randomUUID(),
            action: "meeting.absence",
            input: { meetingId, botId, sessionId: binding.sessionId, error },
          },
          (draft) => {
            const meeting = draft.meetings[meetingId],
              participant = meeting.participants.find(
                (row) => row.botId === botId,
              );
            if (
              meeting.epoch === binding.lineage.epoch &&
              meeting.phase === binding.lineage.phase &&
              participant?.active &&
              participant.memberEpoch === binding.lineage.memberEpoch &&
              participant.sessionId === binding.sessionId
            )
              meeting.absences[botId] = {
                reason: error,
                epoch: meeting.epoch,
                memberEpoch: participant.memberEpoch,
                phase: binding.lineage.phase,
              };
            return null;
          },
        )
        .catch(() => {});
    } finally {
      await this.#finishChannel(binding.sessionId, error);
    }
  }
  async submitOpinion(actor, command) {
    command = this.#input(command, [
      "meetingId",
      "epoch",
      "memberEpoch",
      "text",
      "source",
    ]);
    const input = command.input;
    this.policy.actorKey(actor);
    requireCondition(
      actor.kind === "bot" &&
        typeof input.text === "string" &&
        input.text.length > 0 &&
        input.text.length <= 32000 &&
        plain(input.source) &&
        input.source.sessionId === actor.sessionId &&
        Number.isSafeInteger(input.source.eventSeq),
      "invalid_opinion",
    );
    await this.adapter.context.sessions.flush(actor.agent.session);
    const history = await this.adapter.readNative(actor.sessionId),
      event = history.events.find(
        (row) =>
          row.seq === input.source.eventSeq &&
          row.type === "assistant/message" &&
          !row.data.interrupted,
      );
    requireCondition(
      event &&
        event.data.message.source?.kind === "model" &&
        textOf(event) === input.text,
      "opinion_evidence_mismatch",
    );
    return this.store.transact(this.policy.command(actor, command), (draft) => {
      const meeting = draft.meetings[input.meetingId],
        binding = draft.sessions[actor.sessionId],
        participant = meeting?.participants.find(
          (row) => row.botId === actor.botId,
        ),
        member = draft.groups[meeting?.groupId]?.members.find(
          (row) => row.botId === actor.botId,
        );
      requireCondition(
        meeting &&
          meeting.epoch === input.epoch &&
          binding.lineage?.meetingId === meeting.meetingId &&
          binding.lineage.phase === meeting.phase &&
          participant?.active &&
          participant.sessionId === actor.sessionId &&
          participant.memberEpoch === input.memberEpoch &&
          member?.active &&
          member.epoch === input.memberEpoch,
        "stale_opinion",
      );
      this.policy.require(
        actor,
        "meeting.opinion",
        { kind: "meeting", id: meeting.meetingId },
        draft,
      );
      const opinion = {
        botId: actor.botId,
        text: input.text,
        epoch: meeting.epoch,
        memberEpoch: participant.memberEpoch,
        source: {
          ...copy(input.source),
          meetingId: meeting.meetingId,
          epoch: meeting.epoch,
          phase: meeting.phase,
          memberEpoch: participant.memberEpoch,
          botId: actor.botId,
        },
        origins: this.policy.readDependencies(actor),
        model: copy(binding.model),
      };
      if (meeting.phase === "independent")
        meeting.opinions[actor.botId] = opinion;
      else if (meeting.phase === "discussion")
        meeting.discussion[actor.botId] = opinion;
      else {
        requireCondition(
          meeting.phase === "decision" &&
            actor.botId === meeting.coordinatorBotId,
          "stale_opinion",
        );
        meeting.decision = opinion;
      }
      delete meeting.absences[actor.botId];
      return {
        accepted: true,
        meetingId: meeting.meetingId,
        epoch: meeting.epoch,
        phase: meeting.phase,
      };
    });
  }
  viewGroup(actor, group) {
    const output = copy(group);
    output.messages = output.messages.filter((row) =>
      this.policy.canReadDerived(actor, row),
    );
    for (const row of output.messages)
      this.policy.noteDependencies(actor, row.origins);
    return output;
  }
  viewMeeting(actor, meeting) {
    const output = copy(meeting);
    for (const key of ["opinions", "discussion"])
      output[key] = Object.fromEntries(
        Object.entries(output[key] ?? {}).filter(([, row]) =>
          this.policy.canReadDerived(actor, row),
        ),
      );
    if (output.decision && !this.policy.canReadDerived(actor, output.decision))
      output.decision = null;
    if (actor.kind !== "human") output.history = [];
    for (const row of [
      ...Object.values(output.opinions),
      ...Object.values(output.discussion),
      ...(output.decision ? [output.decision] : []),
    ])
      this.policy.noteDependencies(actor, row.origins);
    return output;
  }
  async advance(actor, command) {
    this.#human(actor);
    command = this.#input(command, ["meetingId", "epoch", "phase", "absences"]);
    const input = command.input;
    const result = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const meeting = draft.meetings[input.meetingId];
        requireCondition(
          meeting?.epoch === input.epoch && meeting.phase === input.phase,
          "stale_meeting",
        );
        const phase = meeting.phase,
          records =
            phase === "independent" ? meeting.opinions : meeting.discussion;
        if (["independent", "discussion"].includes(phase))
          for (const participant of meeting.participants.filter(
            (row) => row.active,
          ))
            if (
              !records[participant.botId] ||
              records[participant.botId].memberEpoch !== participant.memberEpoch
            ) {
              const recorded = meeting.absences[participant.botId];
              const reason =
                input.absences?.[participant.botId] ??
                (recorded?.epoch === meeting.epoch &&
                recorded.memberEpoch === participant.memberEpoch &&
                recorded.phase === phase
                  ? recorded.reason
                  : undefined);
              requireCondition(
                typeof reason === "string" &&
                  reason.length > 0 &&
                  reason.length <= 1000,
                "opinions_incomplete",
              );
              meeting.absences[participant.botId] = {
                reason,
                epoch: meeting.epoch,
                memberEpoch: participant.memberEpoch,
                phase,
              };
            }
        requireCondition(
          ["independent", "discussion", "decision"].includes(phase),
          "invalid_phase",
        );
        if (phase === "decision")
          requireCondition(meeting.decision, "decision_missing");
        meeting.phase =
          phase === "independent"
            ? "discussion"
            : phase === "discussion"
              ? "decision"
              : "complete";
        const old = meeting.participants.map((row) => row.sessionId);
        meeting.absenceHistory ??= [];
        meeting.absenceHistory.push(
          ...Object.entries(meeting.absences).map(([botId, absence]) => ({
            botId,
            ...copy(absence),
          })),
        );
        meeting.absences = {};
        if (meeting.phase !== "complete")
          this.#newParticipants(draft, meeting, meeting.phase);
        return {
          meetingId: meeting.meetingId,
          epoch: meeting.epoch,
          phase: meeting.phase,
          oldChannels: old,
        };
      },
    );
    for (const id of result.oldChannels)
      if (this.adapter.context.agents.get(id))
        void this.adapter.stopResources(id).catch(() => {});
    this.#launchMeeting(result.meetingId);
    return result;
  }
  async changeMembers(actor, command) {
    this.#human(actor);
    command = this.#input(command, [
      "groupId",
      "expectedVersion",
      "botIds",
      "coordinatorBotId",
    ]);
    const input = command.input;
    const result = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const group = draft.groups[input.groupId];
        requireCondition(group, "not_found");
        requireCondition(
          group.version === input.expectedVersion,
          "revision_conflict",
        );
        this.#members(input.botIds, input.coordinatorBotId, draft);
        const changed = [];
        for (const member of group.members) {
          const active = input.botIds.includes(member.botId);
          if (member.active !== active) {
            member.active = active;
            member.epoch++;
            changed.push(member.botId);
          }
        }
        for (const botId of input.botIds)
          if (!group.members.some((row) => row.botId === botId)) {
            group.members.push({ botId, active: true, epoch: 1 });
            changed.push(botId);
          }
        group.coordinatorBotId = input.coordinatorBotId;
        group.ownerBotId = input.coordinatorBotId;
        group.version++;
        const stopped = [],
          relaunch = [];
        for (const meeting of Object.values(draft.meetings).filter(
          (row) =>
            row.groupId === group.groupId &&
            !["complete", "cancelled"].includes(row.phase),
        )) {
          const coordinatorChanged =
            meeting.coordinatorBotId !== group.coordinatorBotId;
          const decisionChanged =
            meeting.phase === "decision" &&
            (coordinatorChanged || changed.length > 0);
          if (decisionChanged) {
            const oldCoordinator = meeting.participants.find(
              (row) => row.botId === meeting.coordinatorBotId,
            );
            if (oldCoordinator?.sessionId)
              stopped.push(oldCoordinator.sessionId);
            meeting.decision = null;
          }
          meeting.coordinatorBotId = group.coordinatorBotId;
          meeting.ownerBotId = group.coordinatorBotId;
          meeting.runtimeId = this.tasks.runtimeId;
          for (const member of group.members.filter((row) => row.active))
            if (!meeting.participants.some((row) => row.botId === member.botId))
              meeting.participants.push({
                botId: member.botId,
                active: true,
                memberEpoch: member.epoch,
                sessionId: null,
              });
          for (const participant of meeting.participants) {
            const member = group.members.find(
              (row) => row.botId === participant.botId,
            );
            const membershipChanged = changed.includes(participant.botId),
              newCoordinator =
                decisionChanged &&
                participant.botId === meeting.coordinatorBotId;
            if (!membershipChanged && !newCoordinator) continue;
            if (participant.sessionId) stopped.push(participant.sessionId);
            participant.active = member.active;
            participant.memberEpoch = member.epoch;
            if (newCoordinator) delete meeting.absences[participant.botId];
            if (membershipChanged) {
              delete meeting.opinions[participant.botId];
              delete meeting.discussion[participant.botId];
              delete meeting.absences[participant.botId];
            }
            if (
              member.active &&
              (meeting.phase !== "decision" ||
                participant.botId === meeting.coordinatorBotId)
            ) {
              const binding = this.#binding(
                draft,
                member.botId,
                meeting.phase === "independent" ? "independent" : "meeting",
                {
                  meetingId: meeting.meetingId,
                  groupId: meeting.groupId,
                  epoch: meeting.epoch,
                  phase: meeting.phase,
                  memberEpoch: member.epoch,
                },
              );
              participant.sessionId = binding.sessionId;
              relaunch.push({
                meetingId: meeting.meetingId,
                botId: member.botId,
              });
            }
          }
        }
        return { group: copy(group), stopped, relaunch };
      },
    );
    for (const id of new Set(result.stopped))
      if (this.adapter.context.agents.get(id))
        void this.adapter.stopResources(id).catch(() => {});
    for (const row of result.relaunch)
      this.#launchMeeting(row.meetingId, row.botId);
    return result.group;
  }
  async changeTopic(actor, command) {
    this.#human(actor);
    command = this.#input(command, [
      "meetingId",
      "epoch",
      "topic",
      "materials",
    ]);
    const input = command.input;
    requireCondition(
      typeof input.topic === "string" &&
        input.topic.length > 0 &&
        input.topic.length <= 1000 &&
        typeof input.materials === "string" &&
        input.materials.length <= 32000,
      "invalid_meeting",
    );
    const result = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const meeting = draft.meetings[input.meetingId];
        requireCondition(
          meeting?.epoch === input.epoch &&
            !["complete", "cancelled"].includes(meeting.phase),
          "stale_meeting",
        );
        const oldChannels = meeting.participants.map((row) => row.sessionId);
        meeting.history.push({
          epoch: meeting.epoch,
          topic: meeting.topic,
          materials: meeting.materials,
          opinions: meeting.opinions,
          discussion: meeting.discussion,
          decision: meeting.decision,
        });
        meeting.epoch++;
        meeting.topicEpoch++;
        meeting.topic = input.topic;
        meeting.materials = input.materials;
        meeting.phase = "independent";
        meeting.opinions = {};
        meeting.discussion = {};
        meeting.decision = null;
        meeting.absences = {};
        meeting.requests = 0;
        this.#newParticipants(draft, meeting, "independent");
        return { meetingId: meeting.meetingId, oldChannels };
      },
    );
    for (const id of result.oldChannels)
      if (this.adapter.context.agents.get(id))
        void this.adapter.stopResources(id).catch(() => {});
    this.#launchMeeting(result.meetingId);
    return this.store.read().meetings[result.meetingId];
  }
  async cancel(actor, command) {
    this.#human(actor);
    command = this.#input(command, ["meetingId", "epoch"]);
    const result = await this.store.transact(
      this.policy.command(actor, command),
      (draft) => {
        const meeting = draft.meetings[command.input.meetingId];
        requireCondition(
          meeting?.epoch === command.input.epoch,
          "stale_meeting",
        );
        meeting.phase = "cancelled";
        return {
          meetingId: meeting.meetingId,
          channels: meeting.participants.map((row) => row.sessionId),
        };
      },
    );
    for (const id of result.channels)
      if (this.adapter.context.agents.get(id))
        void this.adapter.stopResources(id).catch(() => {});
    return result;
  }
  async actionTask(actor, command) {
    command = this.#input(command, [
      "meetingId",
      "epoch",
      "botId",
      "title",
      "goal",
      "criteria",
    ]);
    const input = command.input,
      meeting = this.store.read().meetings[input.meetingId];
    this.policy.require(actor, "meeting.read", {
      kind: "meeting",
      id: input.meetingId,
    });
    requireCondition(
      meeting?.epoch === input.epoch &&
        ["decision", "complete"].includes(meeting.phase) &&
        meeting.decision,
      "decision_missing",
    );
    const task = await this.tasks.create(actor, {
      operationId: command.operationId,
      action: "task.create",
      input: {
        botId: input.botId,
        title: input.title,
        goal: input.goal,
        criteria: input.criteria,
      },
    });
    await this.store.transact(
      {
        operationId: `${command.operationId}:meeting-link`,
        action: "meeting.task-linked",
        input: {
          meetingId: input.meetingId,
          epoch: input.epoch,
          taskId: task.taskId,
        },
      },
      (draft) => {
        const row = draft.meetings[input.meetingId];
        requireCondition(
          row.epoch === input.epoch &&
            ["decision", "complete"].includes(row.phase),
          "stale_meeting",
        );
        if (!row.actions.includes(task.taskId)) row.actions.push(task.taskId);
        return null;
      },
    );
    return task;
  }
  async close() {
    this.#closed = true;
    for (const binding of Object.values(this.store.read().sessions))
      if (
        ["group", "independent", "meeting"].includes(binding.purpose) &&
        this.adapter.context.agents.get(binding.sessionId)
      )
        void this.adapter.stopResources(binding.sessionId).catch(() => {});
    await Promise.allSettled([...this.#runs.values()]);
  }
}
