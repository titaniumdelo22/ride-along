import fs from "node:fs";
import { execSync } from "node:child_process";
const key = fs.readFileSync(".env.local","utf8").match(/GEMINI_API_KEY=(.*)/)[1].trim();
const LABELS=["hot water tap","cold water tap","drip tray","cabinet door","indicator lights","water bottle","condenser coils","compressor","data plate","wiring diagram","power cord","drain plug"];
const short = `Water cooler parts. Detect visible: ${LABELS.join(", ")}. JSON list of {"box_2d":[ymin,xmin,ymax,xmax] 0-1000,"label"}. Labels only from list, once each.`;
for (const size of [480, 640]) {
  execSync(`sips -Z ${size} scratch/SELA_water_cooler_in_office.jpg --out scratch/s${size}.jpg >/dev/null 2>&1`);
  const img = fs.readFileSync(`scratch/s${size}.jpg`).toString("base64");
  for (const model of ["gemini-3.1-flash-lite","gemini-2.5-flash-lite"]) {
    const times=[];
    for (let k=0;k<3;k++){
      const t0=Date.now();
      const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify({contents:[{parts:[{inline_data:{mime_type:"image/jpeg",data:img}},{text:short}]}],generationConfig:{responseMimeType:"application/json",thinkingConfig: model.startsWith("gemini-3")?{thinkingLevel:"minimal"}:{thinkingBudget:0},temperature:0}})});
      const j=await r.json(); times.push(Date.now()-t0);
      if(k==0){const t=j.candidates?.[0]?.content?.parts?.[0]?.text||JSON.stringify(j).slice(0,120); console.log(model,size,"→",t.replace(/\s+/g," ").slice(0,160));}
    }
    console.log(model, size+"px", times.join("/")+"ms");
  }
}
