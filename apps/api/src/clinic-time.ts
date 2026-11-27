function partsAt(epoch: number, timezone: string) {
 const format=new Intl.DateTimeFormat('en-GB',{
  timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
  minute:'2-digit',second:'2-digit',hourCycle:'h23',
 });
 const parts=Object.fromEntries(format.formatToParts(epoch).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}:${parts.second}`};
}

export function clinicDate(epoch:number,timezone:string){
 return partsAt(epoch,timezone).date;
}

export function clinicTime(date:string,hhmm:string,timezone:string):number|undefined{
 const [hourStr,minStr]=hhmm.split(':');
 const hour=Number(hourStr),minute=Number(minStr);
 if(!Number.isInteger(hour)||!Number.isInteger(minute)||hour<0||hour>23||minute<0||minute>59)return undefined;
 const target=Date.parse(date+'T00:00:00Z')+hour*3600000+minute*60000;
 const [day,time]=new Date(target).toISOString().slice(0,19).split('T');
 const offsets=new Set([-86400000,0,86400000].map(delta=>{
  const sample=target+delta;
  const local=partsAt(sample,timezone);
  return Date.parse(local.date+'T'+local.time+'Z')-sample;
 }));
 const candidates=[...offsets].map(offset=>target-offset).filter(epoch=>{
  const local=partsAt(epoch,timezone);
  return local.date===day&&local.time===time;
 });
 // A missing boundary is unsafe to offer. Use the first occurrence for repeated hours.
 return candidates.length?Math.min(...candidates):undefined;
}

export function clinicHour(date:string,hour:number,timezone:string):number|undefined{
 if(!Number.isInteger(hour)||hour<0||hour>24)return undefined;
 if(hour===24){
  const start=clinicTime(date,'00:00',timezone);
  if(start===undefined)return undefined;
  const nextDay=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  return clinicTime(nextDay,'00:00',timezone);
 }
 return clinicTime(date,`${String(hour).padStart(2,'0')}:00`,timezone);
}
