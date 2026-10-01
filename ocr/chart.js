const colors={Observed:'#173a38',Persistence:'#8d978b',Kalman:'#087f75','Chronos-2':'#ad633b',RNN:'#6876a2',LSTM:'#97638c'};
export function drawChart(canvas,snapshot,{count=120,historical=true,hidden=new Set(),horizon=1}={}){
  const ratio=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*ratio;canvas.height=h*ratio;
  const ctx=canvas.getContext('2d');ctx.scale(ratio,ratio);ctx.clearRect(0,0,w,h);
  const css=getComputedStyle(document.documentElement),muted=getComputedStyle(document.body).getPropertyValue('--muted')||css.getPropertyValue('--muted');ctx.fillStyle=muted;ctx.font='11px sans-serif';
  const obs=snapshot.observations.slice(-count);if(!obs.length){ctx.textAlign='center';ctx.fillText('Your first reading will appear here.',w/2,h/2);return;}
  const minTick=obs[0].tick,lastTick=obs.at(-1).tick,maxTick=lastTick+10;
  const forecasts=snapshot.forecasts.filter(f=>f.target_tick>=minTick&&!hidden.has(f.model));
  const latest=new Map();for(const f of forecasts)latest.set(f.model,Math.max(latest.get(f.model)??-Infinity,f.origin_tick));
  const usable=forecasts.filter(f=>f.origin_tick===latest.get(f.model)||(historical&&f.horizon===horizon&&f.target_tick<=lastTick));
  const values=[...obs.filter(o=>o.value!=null).map(o=>o.value),...usable.flatMap(f=>[f.prediction,f.lower??f.prediction,f.upper??f.prediction])];
  if(!values.length)return;let low=Math.min(...values),high=Math.max(...values);const pad=Math.max((high-low)*.12,Math.abs(low)*.001,.01);low-=pad;high+=pad;
  const left=48,right=w-12,top=18,bottom=h-32;const x=t=>left+(t-minTick)/Math.max(1,maxTick-minTick)*(right-left),y=v=>bottom-(v-low)/(high-low)*(bottom-top);
  ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue('--line');ctx.lineWidth=1;ctx.textAlign='right';
  for(let i=0;i<=4;i++){const v=low+(high-low)*i/4;ctx.beginPath();ctx.moveTo(left,y(v));ctx.lineTo(right,y(v));ctx.stroke();ctx.fillText(v.toFixed(2),left-7,y(v)+4);}
  ctx.textAlign='center';let lastLabel=-Infinity;for(const t of [...new Set([minTick,Math.round((minTick+lastTick)/2),lastTick,maxTick])]){const px=Math.max(34,Math.min(w-32,x(t)));if(px-lastLabel<72)continue;const stamp=snapshot.channel.epoch+t*snapshot.channel.interval;const d=new Date(stamp*1000),label=[d.getHours(),d.getMinutes(),d.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');ctx.fillText(label,px,h-10);lastLabel=px;}
  ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x(lastTick),top);ctx.lineTo(x(lastTick),bottom);ctx.stroke();ctx.setLineDash([]);
  function line(points,color,dashed){ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash(dashed?[5,4]:[]);ctx.beginPath();let previous=null;for(const p of points){if(p.value==null){previous=null;continue;}if(previous===null||p.tick>previous+1)ctx.moveTo(x(p.tick),y(p.value));else ctx.lineTo(x(p.tick),y(p.value));previous=p.tick;}ctx.stroke();ctx.setLineDash([]);}
  if(!hidden.has('Observed')){line(obs,document.body.classList.contains('dark')?'#e6f0e9':colors.Observed,false);for(const o of obs.filter(o=>o.value!=null)){ctx.fillStyle=document.body.classList.contains('dark')?'#e6f0e9':colors.Observed;ctx.beginPath();ctx.arc(x(o.tick),y(o.value),2,0,Math.PI*2);ctx.fill();}}
  for(const [model,origin] of latest){
    const series=usable.filter(f=>f.model===model&&f.origin_tick===origin).sort((a,b)=>a.horizon-b.horizon);
    if(model==='Chronos-2'&&series.every(f=>f.lower!=null)){ctx.fillStyle='#ad633b22';ctx.beginPath();series.forEach((f,i)=>i?ctx.lineTo(x(f.target_tick),y(f.lower)):ctx.moveTo(x(f.target_tick),y(f.lower)));[...series].reverse().forEach(f=>ctx.lineTo(x(f.target_tick),y(f.upper)));ctx.closePath();ctx.fill();}
    line(series.map(f=>({tick:f.target_tick,value:f.prediction})),colors[model],true);
    if(historical)line(usable.filter(f=>f.model===model&&f.horizon===horizon&&f.target_tick<=lastTick).sort((a,b)=>a.target_tick-b.target_tick).map(f=>({tick:f.target_tick,value:f.prediction})),colors[model],true);
  }
}
