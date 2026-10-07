import fs from "node:fs";
const key = fs.readFileSync(".env.local","utf8").match(/GEMINI_API_KEY=(.*)/)[1].trim();
const PARTS = ["hot water tap","cold water tap","drip tray","cabinet door","indicator lights","water bottle","condenser coils","compressor","data plate","wiring diagram","power cord","drain plug"];
const img = fs.readFileSync("scratch/SELA_water_cooler_in_office.jpg").toString("base64");
const model = process.argv[2];
const prompt = `Detect every part of this water cooler from this list that is clearly visible: ${PARTS.join(", ")}. Return a JSON list, each entry {"box_2d":[ymin,xmin,ymax,xmax] in 0-1000, "label": one label from the list}. Each label at most once. Skip unseen parts.`;
const body = {contents:[{parts:[{inline_data:{mime_type:"image/jpeg",data:img}},{text:prompt}]}],generationConfig:{responseMimeType:"application/json",thinkingConfig:{thinkingBudget:0}}};
for (let k=0;k<2;k++){
const t0=Date.now();
const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:"POST",headers:{"x-goog-api-key":key,"content-type":"application/json"},body:JSON.stringify(body)});
const j = await r.json(); const ms=Date.now()-t0;
const text=j.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||JSON.stringify(j).slice(0,200);
console.log(model, ms+"ms", text.replace(/\s+/g," ").slice(0,300));
}
