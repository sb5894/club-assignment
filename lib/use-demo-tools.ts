'use client';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
type Tool = {name:string;title:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown};
type ModelContext = { registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void> };
export function useDemoTools(summary:object, openStudent:()=>void){
  const state=useRef({summary,openStudent});state.current={summary,openStudent};
  useEffect(()=>{
    const context=(document as Document & {modelContext?:ModelContext}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const schema={type:'object',properties:{},additionalProperties:false};
    const valid=(input:unknown)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('An empty object is required.');};
    const tools:Tool[]=[
      {name:'read_allocation_summary',title:'동아리 배정 현황',description:'Read counts from the current demo without changing it.',inputSchema:schema,annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){valid(input);return state.current.summary;}},
      {name:'open_student_application',title:'학생 신청 화면 열기',description:'Open the demo student application. Does not submit an application.',inputSchema:schema,annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){valid(input);flushSync(()=>state.current.openStudent());return {view:'student',submitted:false};}},
    ];
    for(const tool of tools){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional browser capability. */}}
    return ()=>lifecycle.abort();
  },[]);
}
