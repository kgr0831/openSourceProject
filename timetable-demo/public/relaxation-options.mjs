export function relaxationChoices(r){
  const rules={};
  if(r.attendanceDays){const v=r.attendanceDays.value,values=[v-1,v+1].filter(n=>n>=1&&n<=r.allowedDays.length&&(r.attendanceDays.mode==='exact'||n>v));if(values.length)rules.attendance_days={label:'등교일 '+v+'일 → '+values.join('일 또는 ')+'일',values,step:1}}
  if(r.morning)rules.morning_limit={label:'오전 수업 상한 '+r.morning.max+' → '+(r.morning.max+1)+' 또는 '+(r.morning.max+2),values:[r.morning.max+1,r.morning.max+2],step:1};
  const c=r.credits.total,values=[1,2].map(n=>({
    min:c.min-Math.min(n,Math.floor(c.min-0.5)),max:c.max+Math.min(n,Math.floor(24-c.max))
  })).filter(v=>v.min!==c.min||v.max!==c.max);
  if(values.length)rules.credit_range={label:'총 학점 범위를 위아래 최대 2학점 넓히기',values,step:1};
  if(r.lunch.enabled&&r.lunch.duration>15)rules.lunch_duration={label:'필수 점심 '+r.lunch.duration+'분 → '+[15,30].map(n=>r.lunch.duration-n).filter(n=>n>0).join('분 또는 ')+'분',values:[15,30].map(n=>r.lunch.duration-n).filter(n=>n>0),step:15};
  return rules;
}

export function relaxationRule({step,values}){
  return {allow:true,importance:1,step,allowed_values:values};
}
