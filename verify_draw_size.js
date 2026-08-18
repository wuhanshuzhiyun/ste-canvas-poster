// 独立复算 posterAdapter/posterEngine 的坐标转换与 buffer 落点，验证是否真的溢出
function transformValue(val, scale) {
  if (typeof val === "number") return Math.floor(val * scale);
  if (typeof val === "string" && /^-?\d+(\.\d+)?$/.test(val)) return Math.floor(parseFloat(val) * scale);
  return val;
}
const NON_DIMENSION_KEYS = new Set(["opacity","lines","flex","zIndex","dpr","text","src","color","borderColor","fontWeight","fontFamily","textAlign","textDecoration","objectFit","display","flexDirection","alignItems","justifyContent","type"]);
function shouldTransform(val){ if(typeof val==="number")return true; if(typeof val==="string"&&/^-?\d+(\.\d+)?$/.test(val))return true; return false;}
function traverseInPlace(obj, scale){
  if(Array.isArray(obj)){for(let i=0;i<obj.length;i++)traverseInPlace(obj[i],scale);return;}
  if(!obj||typeof obj!=="object")return;
  for(const key of Object.keys(obj)){
    const value=obj[key];
    if(value&&typeof value==="object"){traverseInPlace(value,scale);}
    else if(shouldTransform(value)){
      const num=typeof value==="number"?value:parseFloat(value);
      if(key==="lineHeight"){ if(!isFinite(num)||num<=10)continue; }
      if(NON_DIMENSION_KEYS.has(key))continue;
      obj[key]=transformValue(value,scale);
    }
  }
}

function transformSchemaWithScale(schema, scale){
  if(!schema||typeof schema!=="object")return schema;
  traverseInPlace(schema,scale);
  return schema;
}

// 测试用例 1 真实 schema
const schema = {
  width:710, height:1200,
  views:[
    {type:"view",css:{left:40,top:40,width:630,height:200}},
    {type:"view",css:{left:40,top:280,width:300,height:160}},
    {type:"view",css:{right:40,top:280,width:300,height:160}},
    {type:"view",css:{left:40,top:480,width:630,height:120}},
    {type:"view",css:{left:40,top:640,width:630,height:160}},
  ]
};

// 复刻 renderPoster 的 H5 分支
const cardW = 312;          // canvas.getBoundingClientRect().width
const designW = 710;        // schemaCopy.width
const scale = cardW / designW; // 0.4394
console.log("scale =", scale.toFixed(4));

transformSchemaWithScale(schema, scale);
console.log("转换后 schema.width =", schema.width, " schema.height =", schema.height);

// 复刻 render()
const width = schema.width, height = schema.height;        // 312, 527
const displayW = 312, displayH = 527;                       // getBoundingClientRect
const dpr = 1;                                              // H5 已强制 dpr=1
const canvasW = Math.round(displayW * dpr);                 // 312
const canvasH = Math.round(displayH * dpr);                 // 527
const fit = width > 0 ? displayW / width : 1;               // 1
const renderScale = dpr * fit;                              // 1
console.log("canvas buffer =", canvasW+"x"+canvasH, " renderScale =", renderScale);

// H5 dpr=1 后：buffer 与窗口同为 CSS 逻辑像素，可直接比大小
const winW = 390, winH = 844;                               // 设备模式视口（CSS px）
console.log(`窗口(CSS) = ${winW}x${winH}   buffer(CSS, dpr=1) = ${canvasW}x${canvasH}`);
console.log(`=> buffer ${canvasW <= winW && canvasH <= winH ? "完全落在窗口内，不存在溢出屏幕" : "超出窗口"}`);


console.log("\n元素 buffer 物理坐标落点（×renderScale），与 canvas buffer 比较：");
let bufferOverflow = [];
schema.views.forEach((view, i) => {
  const css = view.css;
  let resolvedWidth = css.width;
  let resolvedHeight = css.height;
  const refWidth = width, refHeight = height;
  let x, y;
  if (css.right != null && css.right >= 0) x = refWidth - css.right - resolvedWidth;
  else x = css.left;
  if (css.bottom != null && css.bottom >= 0) y = refHeight - css.bottom - resolvedHeight;
  else y = css.top;
  const bufX = x * renderScale, bufY = y * renderScale;
  const bufW = resolvedWidth * renderScale, bufH = resolvedHeight * renderScale;
  const bufRight = bufX + bufW, bufBottom = bufY + bufH;
  const over = bufRight > canvasW + 0.5 || bufBottom > canvasH + 0.5;
  if (over) bufferOverflow.push(i+1);
  console.log(
    `#${i+1} type=${view.type} ` +
    `logical={x:${x},y:${y},w:${resolvedWidth},h:${resolvedHeight}} ` +
    `bufRight:${bufRight} bufBottom:${bufBottom} ` +
    (over ? "⚠️OVERFLOW(buffer)" : "OK")
  );
});
console.log("\n=> buffer 级溢出计数:", bufferOverflow.length, bufferOverflow.length ? "indices="+JSON.stringify(bufferOverflow) : "(零溢出)");
console.log("=> 逻辑级：画布", width+"x"+height, " buffer", canvasW+"x"+canvasH);
