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

export function clinicHour(date:string,hour:number,timezone:string):number|undefined{
 const target=Date.parse(date+'T00:00:00Z')+hour*3600000;
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
