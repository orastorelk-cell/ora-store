import { SHEET_CONFIRM_API } from './sheetConfirmState';

export type SavedSheetConnection={connected:boolean;spreadsheet_id?:string;tabs?:string[];client_email?:string};
export type SheetConnectionState={connection:SavedSheetConnection|null;checking:boolean;error:string};
type Clock={schedule:(task:()=>void,delay:number)=>unknown;cancel:(id:unknown)=>void};

// A failed status read is not an unconnected Sheet. Keep the server's saved
// connection authoritative on every device; never cache or require its key here.
export function watchSavedSheetConnection(
  request:(path:string)=>Promise<any>,
  notify:(state:SheetConnectionState)=>void,
  clock:Clock={schedule:(task,delay)=>setTimeout(task,delay),cancel:id=>clearTimeout(id as ReturnType<typeof setTimeout>)},
) {
  let stopped=false,pending:Promise<void>|null=null,timer:unknown,failures=0;
  let connection:SavedSheetConnection|null=null;
  const later=(delay:number)=>{if(!stopped)timer=clock.schedule(()=>{timer=undefined;void refresh();},delay);};
  const refresh=():Promise<void>=>{
    if(stopped)return Promise.resolve();
    if(pending)return pending;
    if(timer!==undefined){clock.cancel(timer);timer=undefined;}
    notify({connection,checking:true,error:''});
    pending=(async()=>{
      try{
        const data=await request(SHEET_CONFIRM_API+'/connection');
        if(stopped)return;
        const saved=data?.connection;
        if(typeof saved?.connected!=='boolean'||(saved.connected&&(!saved.spreadsheet_id||!Array.isArray(saved.tabs)||!saved.tabs.length)))throw new Error('The saved Sheet connection response was incomplete.');
        connection=saved;failures=0;
        notify({connection,checking:false,error:''});
        // Another device may finish the one-time setup while this page is open.
        if(!connection.connected)later(30000);
      }catch(failure:any){
        if(stopped)return;
        failures++;
        notify({connection,checking:false,error:failure?.message||'Saved Google Sheet connection could not be checked.'});
        if(![401,403].includes(failure?.status))later(Math.min(30000,5000*failures));
      }finally{pending=null;}
    })();
    return pending;
  };
  return {refresh,stop:()=>{stopped=true;if(timer!==undefined)clock.cancel(timer);}};
}
