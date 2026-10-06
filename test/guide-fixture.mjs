import { createHash } from 'node:crypto';
export const guideText=`说明：Session创建时绑定AgentPreset；Bot默认变更只影响以后显式新建会话，不热切已有Session。预设不授予权限。private-runtime-owner保持publicHumanAuthorityVerified=false；owner/empty、零模型工具。这里是合成离线指南，HTTP成功与native结算不等于内容合格，历史FAIL/unknown保持。
1. OS启动dsh --profile dsh-bot-owner --init｜显式新建两条不同的空Session｜ready与两Session ID。
2. stdin status查看会话与操作｜默认run关闭，状态可读｜stdout状态。
3. 原operationId prepare同输入与异输入｜同ID复用，冲突拒绝｜原ID inspect与拒绝记录。
4. admit后尝试默认run｜未启用--enable-model-requests则拒绝且未发送｜拒绝及零请求。
5. 本进程显式启用--enable-model-requests后run｜known usage与native durable receipt，内容另判｜原ID inspect与receipt。
6. execution活跃时询问独立contact Session｜contact为独立联络Session，可与主执行并行｜两Session ID、活跃时间和原生结果。
7. stop后该generation新prepare｜fence拒绝；未发送可释放未用预留；已发送无远端终态确认保持unknown与预留，abort/drain不证明远端停止｜fence、原ID、usage与reservation记录。
8. close后显式--resume原Session ID｜不重放，不清unknown，保留原ID与预留容量｜前后原ID、状态及零重发。`;
export const textSha=text=>createHash('sha256').update(text).digest('hex');
export const knownExecution=()=>({operationId:'original-1',nativeOperationId:'native-original-1',state:'settled',reservationHeld:false,
 localTransport:'closed',remoteExecution:'response_observed',errorCategory:null,
 usage:{inputTokens:5,outputTokens:3,cacheReadTokens:0,cacheWriteTokens:0,totalTokens:8},
 receipt:{sessionId:'fresh-session',turn:1,step:1,startSeq:2,assistantSeq:4,endSeq:6,assistantDigest:'a'.repeat(64),endDigest:'b'.repeat(64)},answers:[guideText]});
export function guideInput(overrides={}){const text=overrides.text ?? guideText,task=overrides.task ?? {taskId:'guide-task',revision:2,acceptanceVersion:3};
 return {task,text,stopReason:'end_turn',automaticVerdict:'passed',semanticVerdict:{outcome:'passed',artifactDigest:textSha(text),acceptanceVersion:task.acceptanceVersion},
  expectedAuthorityEpoch:4,executionEvidence:knownExecution(),...overrides};}
