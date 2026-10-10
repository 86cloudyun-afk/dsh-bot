const terminalMethods=new Set(['abort','continue','fallback','fulfill']);

// Playwright dispatches route callbacks independently of the test's awaited UI
// work. Keep their failures in this scope and settle failed requests before
// returning to that dispatcher, then surface every failure from awaited close.
export async function createTrackedRoute(page,url,handle) {
  const pending=new Set(),failures=[];
  let accepting=true,teardown;
  const retain=error=>failures.push(error);
  const handler=route=>{
    const accepted=accepting;
    let settled=false;
    const managed=new Proxy(route,{get(target,key){
      const value=Reflect.get(target,key);
      if(typeof value!=='function')return value;
      if(!terminalMethods.has(key))return value.bind(target);
      return async(...args)=>{
        const result=await value.apply(target,args);
        settled=true;
        return result;
      };
    }});
    const work=(async()=>{
      try {
        if(accepted)await handle(managed);
        else await managed.continue();
        if(!settled)throw new Error('Route callback returned without settling its request');
      } catch(error) {
        retain(error);
        if(!settled) {
          try {await managed.abort('failed');}
          catch(abortError) {retain(abortError);}
        }
      }
    })();
    pending.add(work);
    void work.then(()=>pending.delete(work));
    return work;
  };
  await page.route(url,handler);
  const drain=async()=>{
    while(pending.size)await Promise.all([...pending]);
  };
  const throwFailure=()=>{
    if(failures.length===1)throw failures[0];
    if(failures.length>1)throw new AggregateError(failures,'Tracked route scope failed',{cause:failures[0]});
  };
  return {failures,drain,throwFailure,async close(primaryError) {
    // Flip this before the first await: requests arriving during drain pass
    // through instead of extending the controlled mutation or held gate.
    accepting=false;
    if(primaryError!==undefined && !failures.includes(primaryError))retain(primaryError);
    teardown??=(async()=>{
      await drain();
      try {await page.unroute(url,handler);}
      catch(error) {retain(error);}
      // A pass-through callback can arrive while unroute is in progress.
      await drain();
    })();
    await teardown;
    throwFailure();
  }};
}

export async function withTrackedRoute(page,url,handle,run) {
  const scope=await createTrackedRoute(page,url,handle);
  let value,primaryError;
  try {value=await run();}
  catch(error) {primaryError=error;}
  await scope.close(primaryError);
  return value;
}
