import re
from collections import Counter
NATIVE_EVENT_KEYS={'index','admission','reason','outcome','identity'}
NATIVE_ID_KEYS={'scope','contentSHA256','packageIdentity','payloadIdentity','pathRelation','isPathAlias','unknownReason'}
NATIVE_UNKNOWN_REASONS={'INVALID_FILENAME','PATH_TRAVERSAL','NOT_IN_SOURCE_INVENTORY','SOURCE_READ_NOT_GRANTED','OUT_OF_SCOPE','INVALID_EXTENSION','PATH_COMPONENT_LIMIT','SYMLINK_COMPONENT','NOT_DIRECTORY','NOT_REGULAR','CANONICAL_PATH_CHANGED','INVALID_METADATA','FILE_TOO_LARGE','READ_INTERFACE_UNAVAILABLE','FILE_CHANGED','UNREADABLE','CLOSE_FAILED','UNKNOWN_HASH','ATTEMPT_RECORD_LIMIT','INSPECTION_PENDING'}
NATIVE_DENIALS={'OTHER_ADDON_LOAD_REFUSED','PINNED_ADDON_HASH_REFUSED','ADDON_LOAD_LIMIT_REFUSED','ADDON_ATTEMPT_RECORD_LIMIT_REFUSED'}
NATIVE_FINAL_STAGES={'PROCESS_EXIT','SETUP_FAILED_EXIT','GUARD_PREFLIGHT_COMPLETE'}

def native_ledger_valid(trace):
    def integer(x,maximum):return type(x) is int and 0<=x<=maximum
    try:
        if type(trace) is not dict:return False
        events=trace['nativeAttempts'];total=trace['nativeLoadAttempts'];loads=trace['nativeLoads'];boundary=trace['boundaryRefusals'];terminal=trace['stage'] in NATIVE_FINAL_STAGES
        if type(events) is not list or not integer(total,17) or len(events)!=total or not integer(loads,1):return False
        if type(boundary) is not list or len(boundary)>32 or any(type(x) is not str for x in boundary):return False
        observed_loads=0;observed_admissions=0;denials=Counter()
        for index,event in enumerate(events,1):
            if type(event) is not dict or set(event)!=NATIVE_EVENT_KEYS or type(event['index']) is not int or event['index']!=index:return False
            identity=event['identity']
            if type(identity) is not dict or set(identity)!=NATIVE_ID_KEYS:return False
            scope=identity['scope'];digest=identity['contentSHA256'];package=identity['packageIdentity'];payload=identity['payloadIdentity'];relation=identity['pathRelation'];alias=identity['isPathAlias'];unknown=identity['unknownReason']
            if any(type(x) is not str for x in [scope,package,payload,relation,unknown]):return False
            if scope not in {'UNKNOWN','KNOWN_SOURCE','OWNED_ROOT'} or relation not in {'UNKNOWN','EXACT_ALLOWED_PATH','ALLOWED_PATH_ALIAS','OTHER_FILE'}:return False
            if alias is not None and type(alias) is not bool:return False
            if alias is not (None if relation=='UNKNOWN' else relation=='ALLOWED_PATH_ALIAS'):return False
            if relation in {'EXACT_ALLOWED_PATH','ALLOWED_PATH_ALIAS'} and scope!='KNOWN_SOURCE':return False
            if digest is not None and (type(digest) is not str or re.fullmatch('[0-9a-f]{64}',digest) is None):return False
            known=NATIVE_HASH_IDENTITIES.get(digest)
            if known is not None:
                if (package,payload)!=known or unknown!='NONE' or scope=='UNKNOWN' or relation=='UNKNOWN':return False
            else:
                if package!='UNKNOWN' or payload!='UNKNOWN' or unknown not in NATIVE_UNKNOWN_REASONS:return False
                if digest is not None and (unknown!='UNKNOWN_HASH' or scope=='UNKNOWN' or relation=='UNKNOWN'):return False
                if digest is None and relation!='UNKNOWN':return False
            if terminal and unknown=='INSPECTION_PENDING':return False
            admission=event['admission'];reason=event['reason'];outcome=event['outcome']
            if any(type(x) is not str for x in [admission,reason,outcome]):return False
            pinned=scope=='KNOWN_SOURCE' and digest==NATIVE_GLIBC_PIN and relation=='EXACT_ALLOWED_PATH' and unknown=='NONE'
            if index==17:
                if (admission,reason,outcome,unknown)!=('DENY','ADDON_ATTEMPT_RECORD_LIMIT_REFUSED','NOT_CALLED','ATTEMPT_RECORD_LIMIT'):return False
            elif reason=='ADDON_ATTEMPT_RECORD_LIMIT_REFUSED' or unknown=='ATTEMPT_RECORD_LIMIT':return False
            if admission=='PENDING':
                if terminal or reason!='NONE' or outcome!='NOT_CALLED':return False
            elif admission=='DENY':
                if reason not in NATIVE_DENIALS or outcome!='NOT_CALLED':return False
                if reason=='ADDON_LOAD_LIMIT_REFUSED' and (observed_admissions!=1 or not pinned):return False
                if reason=='PINNED_ADDON_HASH_REFUSED' and pinned:return False
                denials[reason]+=1
            elif admission=='ALLOW':
                if not pinned or observed_admissions!=0:return False
                observed_admissions+=1
                if outcome=='IN_PROGRESS':
                    if terminal or reason!='NONE':return False
                elif outcome=='LOAD_FAILED':
                    if reason!='ORIGINAL_DLOPEN_FAILED':return False
                elif outcome=='LOADED':
                    if reason!='NONE':return False
                    observed_loads+=1
                elif outcome=='LOADED_EXPORT_REFUSED':
                    if reason!='NATIVE_EXPORT_SURFACE_REFUSED':return False
                    observed_loads+=1;denials[reason]+=1
                elif outcome=='LOADED_WRAP_FAILED':
                    if reason!='NATIVE_WRAP_FAILED':return False
                    observed_loads+=1
                else:return False
            else:return False
        expected=Counter(x for x in boundary if x in NATIVE_DENIALS or x=='NATIVE_EXPORT_SURFACE_REFUSED')
        return observed_loads==loads and denials==expected
    except (KeyError,TypeError,ValueError,RecursionError):return False
