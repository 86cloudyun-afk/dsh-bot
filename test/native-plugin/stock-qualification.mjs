import assert from 'node:assert/strict';
import {readFile,appendFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publicStockError} from './stock-report.mjs';

// The complete named contract is intentionally independent of runner output.
// Add new installed checks here when their real browser assertions are added.
export const guiCheckNames=Object.freeze([
  "nativeAuthenticationRequired",
  "threeSeparateBotIdentities",
  "contactUsesOwnModel",
  "longOwnsARealRunningNativeJob",
  "contactRespondsDuringLongWork",
  "shortCompletesBeforeLongWork",
  "longOwnsRealNativePty",
  "reservedResultIdInOriginalNativeLog",
  "realNativeChildDepthAndDescriptor",
  "actualNativeChildView",
  "actualExecutionView",
  "sameTaskNewAttempt",
  "taskGuiLifecycle",
  "physicalHeartbeatStopped",
  "nativeJobsQuiescent",
  "physicalPtyStopped",
  "nativePtyQuiescent",
  "twoIndependentMeetings",
  "twoMeetingsBelongToSameGroup",
  "nativeOpinionsDiscussionAndDecisions",
  "linkedRealActionTask",
  "ordinaryStopPreservesOrdinaryOwnership",
  "guiSelectsOrdinaryResultOrigin",
  "twoBrowserPagesReuseSameIdentity",
  "sameNativeHistoryAfterRestore",
  "coldRestoresOriginalBotIds",
  "coldRestoresOwnMemory",
  "stockControllerColdUsesBotModel",
  "globalModelUnchanged",
  "disabledUnregistersNativeService",
  "disableDoesNotCancelUnrelatedOrdinaryAgent",
  "reenableRetainsIdentity",
  "standardUninstallReinstallPreservesData",
  "botCreationHasOnlyThreeVisibleFields",
  "noManualNativeToolConfiguration",
  "fivePrimaryWorkbenchSections",
  "nameOnlyCreationUsesConfiguredDefaults",
  "botCardStartsItsOwnConversationDirectly",
  "collapsedSettingsRetainExistingConfiguration",
  "renamingDoesNotImportGlobalReasoningEffort",
  "executionInheritancePreservesCurrentReasoningDefaults",
  "newModelSelectionClearsIncompatibleReasoning",
  "explicitSameRouteExecutionRemainsFixedAfterReopening",
  "allOriginalManagementAndCollaborationSectionsAccessible",
  "taskRegistrationUsesOnlyThreeVisibleFields",
  "taskAdjustmentIsCollapsedByDefault",
  "noBrowserScriptErrors",
  "mixedReleaseRefusesFirstBotWrite",
  "lostFirstBotReceiptReadWithoutReplay",
  "rejectedFirstBotRetainsOriginalWithoutAutomaticRetry",
  "foldedOriginalRequestSurvivesBrowserReload",
  "unsavedContactAndExecutionChoicesSurviveCatalogRemoval",
  "taskDraftConflictPreservesBothDraftAndNewGoal",
  "staleSharingDraftCannotRestoreRevokedAccess",
  "missingNativePresetNeverImplicitlyResetsOnRename",
  "nativePresetDefaultSelectionActuallyResets",
  "repairRecoveryChecksIssueNoModelRequests",
  "shareDraftRemainsBoundToSelectedBotIds",
  "savingShareDoesNotAddAnUnselectedBot",
  "externalBotUpdatePreservesDraftAndChecksItsOriginalVersion",
  "explicitBotDraftReloadAllowsSavingTheLatestVersion",
  "duplicateBotNamesAreDisambiguatedByStableIdentity",
  "refreshAddsOrdinaryResultRecipientsWithoutClearingTaskDraft",
  "slowRecipientResponsesSurviveAutomaticRefresh",
  "blankContactIsBoundWhileNativeHeaderIsHidden",
  "blankBotChatShowsIdentityWithoutModelRequest",
  "activeNativeChatKeepsCorrectBotIdentity",
  "switchingNativeSessionsUsesTheirOwnBotBinding",
  "botChatIdentitySurvivesBrowserRefresh",
  "duplicateBotNamesKeepStableIdentityInNativeChat",
  "chatIdentityOpensBotWorkbench",
  "deleteDialogContainsKeyboardFocusAndEscapeCancels",
  "botDeletionRequiresExplicitConfirmation",
  "staleDeleteConfirmationCannotOverrideAnotherPage",
  "deletingEditedBotClosesItsStaleEditor",
  "deletedBotLeavesMainListAndKeepsHistoryAndMemory",
  "deletedBotCannotBeChosenForNewChat",
  "deletedOriginalChatShowsHistoricalBotIdentity",
  "restoreKeepsBotIdentityPausedUntilExplicitActivation",
  "restoredBotContinuesItsOriginalNativeChat",
  "v11PinnedMemoryEditPreservesIdentitySourceAndCAS",
  "v11MemoryPinToggleUsesTheSameEditedRecordAndCAS",
  "v11MemoryExportImportUsesActualDownloadDigestPreviewAndReceipt",
  "v11ContextPreviewReturnsThePinnedEditedMemory",
  "v11MaterialUploadSearchAndCitationUseExactUnicodeRangesLinesAndHash",
  "v11MaterialNativeSourceIsVerifiedAndOpensTheOriginalContact",
  "v11KnowledgeMemoryAndContextIssueNoModelRequests",
  "v11TeamTemplateCreatesTwoBotsAndGroupInOneReceiptWithoutConversation",
  "v11TaskDependencyUIBlocksNativeAdmissionBeforeRealAcceptance",
  "v11AcceptedDependencyNativeInputAndSettledHandoffPreserveAttemptIdentities",
  "v11ScheduleCreatePauseEditRealReminderAndReadUseOriginalIdentities",
  "v11ScheduleArchiveAndExplicitConfirmedHistoryCleanupRetainReceipts",
  "v11BriefingShowsRealResultAndNavigatesToItsTaskWithoutReplay",
  "v11DiagnosticsPreviewRendersActualAllowlistedResponseWithoutModelOrBody",
  "v11OwnedContactUIConfigureWritesNativeTitleAndScopedModelWithoutGlobalChange",
  "v11OwnedContactUIForkRetainsVerifiedFullNativePrefixAndBotIdentity",
  "v11SeededForkUIChatUsesItsOwnNativeModelAndLeavesOriginalContactIntact",
  "v11UiNoExternalModelRequests",
  "v111PendingMaterialReadProtectsTitleBodyAndSaveIntent",
  "v111LatestAcceptedFileWinsActualRpcAndStoredExactBytesSha256",
  "v111HeldActualBotAMemorySearchCannotReplaceBotBVisibleMemory",
  "v111ScheduleReconfirmationWithinOriginalDeadlineRetiresOnlyUnadmittedOldTrigger",
  "v111CorrectedFutureTriggerRunsOnceWithActualNativeResultAndOriginalReceipts",
  "v111PendingConfigureRejectsArchiveRestoreBeforeDurableOrNativeSideEffects",
  "v111OriginalConfigureSettlesNativeTitleAndExactFinalReceiptOnce",
  "v111QualityUsesNoExternalModelRequests",
  "v112PendingMemoryReplacementDisablesStaleConfirmation",
  "v112CanceledHeldMemoryReadCannotRestorePreviewOrIssueImport",
  "v112OutOfOrderActualMaterialRepliesKeepLatestSearch",
  "v112ShowAllMaterialsInvalidatesHeldActualSearch",
  "v114DeferredSessionRosterKeepsDiagnosticSelectionAndOpenState",
  "v112ChangedDiagnosticSelectionCannotReviveHeldActualPreview",
  "v112CatalogRefreshPreservesNewPendingOriginalOperation",
  "v112CatalogRefreshPreservesRetainedOriginalOperationHistory",
  "v112RunningNoopAdjustmentPreservesOriginalNativeResultAndReceipt",
  "v112QualityUsesNoExternalModelRequests",
  "v113ForcedRefreshDuringActualPollLoadsLatestCatalog",
  "v113MaterialSearchRetryClearsOnlyItsOwnError",
  "v113UntouchedSharingPreservesWildcardForFutureBotRead",
  "v113ScheduleOwnerReadOnlyOnEditAndSelectableOnCreate",
  "v113QualityUsesNoExternalModelRequests"
]);
const prior=(version,sha256,schema)=>Object.freeze({version,sha256,schema});
export const stockSources=Object.freeze({
  gui:null,
  upgrade:prior('1.0.0','1a8cab4c29db54ace76160d1e6e1ac9dfc7a4e291f77b65f974bab30fbaa1724',1),
  'upgrade-v101':prior('1.0.1','e3eca64ca596c1609e5f447e2c0ba8e2e4a778bf0e583e22a07623e00c3fa1dd',1),
  'upgrade-v102':prior('1.0.2','c0e72fe808dddd31d74ad4907dcfb30f7736a7782a83bb307a6d4ca6587de822',1),
  'upgrade-v110':prior('1.1.0','5ca1ebde0a3d59869f180e2fe692dcfb70b32aadb885f5d1d624093c425e85e1',2),
  'upgrade-v111':prior('1.1.1','cf651bff75f9fa144e05b0db7fd6284038c50bcafb8a44ccfa8b0d4d66bb9c92',2),
  'upgrade-v112':prior('1.1.2','426a244ae02927129e315420907ab4b2f9acf16414144e0e6792b7f25bfe48ff',2),
  'upgrade-v113':prior('1.1.3','55c192a3837d36ff6dd78fa5f34c36d2375a648258ddd499f793d6e3a47ae289',2),
});
const stableVersion=version=>typeof version==='string'&&/^\d+\.\d+\.\d+$/.test(version);
const hex=(value,size)=>typeof value==='string'&&new RegExp(`^[a-f\\d]{${size}}$`).test(value);

export function expectedStockChecks(source,version) {
  assert.ok(Object.hasOwn(stockSources,source),'Unsupported stock qualification source');
  assert.ok(stableVersion(version),'Invalid target package version');
  if(source==='gui')return [...guiCheckNames];
  const previous=stockSources[source],from=previous.version.replaceAll('.',''),to=version.replaceAll('.','');
  return [
    ...(previous.schema===1?['upgradeSchemaTwoAndVerifiedExactSchemaOneBackup','upgradePreservesEveryOriginalIdentityAndReceipt']:[`upgradeV${from}SchemaTwoFullHostRestartRetainsExistingBackupExactly`,`upgradeV${from}PreservesEveryOriginalIdentityReceiptAndExactV11Rows`]),
    'upgradePreservesRealSettledAttemptOutboxAndOriginalNativeLog',
    `v${from}ToV${to}StandardUpgradePreservesOriginalIdentities`,
    'upgradedOriginalReceiptLookupNeverRecreatesBot',
    'upgradedStockGuiCreatesNextBot',
    'upgradeAndReceiptLookupIssueNoModelRequests',
  ];
}

/** Bind the expected report hash to the actual frozen package's name/version. */
export async function readStockTarget({root=resolve(import.meta.dirname,'../..'),sourceCommit=process.env.GITHUB_SHA}={}) {
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  assert.equal(manifest.name,'dsh-bot','Unexpected package name');
  assert.ok(stableVersion(manifest.version),'Invalid target package version');
  const artifact=join(root,'dist',`${manifest.name}-${manifest.version}.tgz`);
  const packed=JSON.parse(execFileSync('tar',['-xzOf',artifact,'package/package.json'],{maxBuffer:256*1024,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal(packed.name,manifest.name,'Frozen package name differs from current manifest');
  assert.equal(packed.version,manifest.version,'Frozen package version differs from current manifest');
  const sha256=createHash('sha256').update(await readFile(artifact)).digest('hex');
  const checksum=(await readFile(join(root,'dist/SHA256SUMS'),'utf8')).trim();
  assert.equal(checksum,`${sha256}  ${basename(artifact)}`,'Frozen package checksum differs');
  sourceCommit??=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  assert.ok(hex(sourceCommit,40),'Invalid expected source commit');
  return {packageName:manifest.name,packageVersion:manifest.version,artifactSha256:sha256,sourceCommit,officialVersion:manifest.devDependencies['@deepseek-ai/dsh']};
}

function requestCount(report) {
  let count;
  if(Array.isArray(report.requests))count=report.requests.length;
  if(report.controlledRequests!==undefined) {
    assert.ok(Number.isSafeInteger(report.controlledRequests)&&report.controlledRequests>=0,'Invalid controlled request count');
    if(count!==undefined)assert.equal(count,report.controlledRequests,'Request array/count disagree');
    count=report.controlledRequests;
  }
  assert.ok(Number.isSafeInteger(count)&&count>=0,'Missing controlled request evidence');
  return count;
}

/** Reject partial, stale, foreign-source and cleanup-incomplete qualifications. */
export function validateStockReport(report,{source,target}) {
  assert.ok(target&&target.packageName==='dsh-bot'&&stableVersion(target.packageVersion),'Invalid target package identity');
  assert.ok(hex(target.artifactSha256,64)&&hex(target.sourceCommit,40),'Invalid expected report provenance');
  const required=expectedStockChecks(source,target.packageVersion);
  assert.ok(report&&typeof report==='object'&&!Array.isArray(report),'Missing stock report');
  for(const key of ['passed','testsPassed','teardownComplete','standardProfile','standardPluginInstall','controlledProvider'])assert.equal(report[key],true,`Required qualification flag: ${key}`);
  assert.equal(report.sourceTreeDirty,false,'Qualification source tree must be clean');
  assert.equal(report.sourceCommit,target.sourceCommit,'Qualification source commit differs');
  assert.equal(report.artifactSha256,target.artifactSha256,'Qualification target artifact differs');
  assert.equal(report.officialVersion,target.officialVersion,'Official host version differs');
  if(report.artifactPackageVersion!==undefined)assert.equal(report.artifactPackageVersion,target.packageVersion,'Qualification package version differs');
  assert.equal(report.realModelRequests,0,'External model requests are not part of controlled qualification');
  assert.deepEqual(report.browserErrors,[],'Browser errors cannot qualify');
  for(const key of ['error','teardownError','privateLogError'])assert.equal(report[key],undefined,'Qualification contains a failure');
  assert.notEqual(report.fatalExit,true,'Fatal exits cannot qualify');
  assert.ok(report.checks&&typeof report.checks==='object'&&!Array.isArray(report.checks),'Missing named qualification checks');
  assert.deepEqual(Object.keys(report.checks).sort(),required.sort(),'Qualification named check set differs');
  assert.ok(Object.values(report.checks).every(value=>value===true),'All required checks must be true');
  const count=requestCount(report);
  if(source==='gui') {
    assert.equal(report.stage,'complete','GUI qualification did not reach completion');
    assert.ok(count>0,'GUI qualification needs actual controlled native requests');
  } else {
    const previous=stockSources[source];
    assert.equal(count,0,'Upgrade and receipt lookup cannot issue target model requests');
    assert.equal(report.previousArtifactSha256,previous.sha256,'Immutable upgrade source differs');
    assert.equal(report.upgradeArtifactSha256,target.artifactSha256,'Upgrade target artifact differs');
    assert.equal(report.freshHostProcessAfterUpgrade,true,'Upgrade requires a fresh host process');
    if(report.upgradeFromVersion!==undefined)assert.equal(report.upgradeFromVersion,previous.version,'Upgrade source version differs');
    if(report.upgradeToVersion!==undefined)assert.equal(report.upgradeToVersion,target.packageVersion,'Upgrade target version differs');
    if(previous.schema===1) {
      const proof=report.migration;assert.equal(proof?.fromSchema,1);assert.equal(proof?.toSchema,2);
      assert.ok(hex(proof?.backupChecksum,64),'Migration backup needs a checksum');
      for(const key of ['backupPayloadMatchesOriginal','allOriginalReceiptIdentitiesPreserved','legacySnapshotReadFromClosedOfficialKv'])assert.equal(proof?.[key],true,`Required schema-one proof: ${key}`);
    } else {
      const proof=report.upgradeSchemaTwo;assert.equal(proof?.fromSchema,2);assert.equal(proof?.toSchema,2);
      assert.equal(typeof proof?.backupWasPresent,'boolean','Existing backup presence must be recorded');
      for(const key of ['existingMigrationBackupRetained','allOriginalReceiptIdentitiesPreserved','exactV11RowsRetained','sourceSnapshotReadFromClosedOfficialKv'])assert.equal(proof?.[key],true,`Required schema-two proof: ${key}`);
    }
  }
  return {source,passed:true,checks:required.length};
}

/** The CLI gate and public readable check share these exact verdicts. */
export async function qualifyStockReports(directory,{target}={}) {
  target??=await readStockTarget();
  const reports={},rows=[];
  for(const source of Object.keys(stockSources)) {
    let report;
    try {
      report=JSON.parse(await readFile(join(directory,source,'stock-gui-report.json'),'utf8'));
      rows.push(validateStockReport(report,{source,target}));reports[source]=report;
    } catch(error) {
      rows.push({source,passed:false,checks:report?.checks&&typeof report.checks==='object'?Object.keys(report.checks).length:0,error:publicStockError(error)});
      reports[source]={passed:false,error:publicStockError(error)};
    }
  }
  return {passed:rows.every(row=>row.passed),rows,reports,target};
}

export function stockQualificationSummary(rows) {
  return ['## Official stock qualification','','| Profile | Result | Checks |','| --- | --- | --- |',...rows.map(row=>`| ${row.source} | ${row.passed?'Passed':'Failed or missing'} | ${row.checks} |`),''].join('\n');
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  try {
    const result=await qualifyStockReports(resolve(process.argv[2]??'qualification'));
    const summary=stockQualificationSummary(result.rows);console.log(summary);
    if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary);
    if(!result.passed)process.exitCode=1;
  } catch(error) {
    console.log(JSON.stringify({passed:false,error:publicStockError(error)}));process.exitCode=1;
  }
}
