/* Smaller new profile photos without changing framing or animated avatars. */
(function(){
 'use strict';
 async function optimize(file,original){
  if(!['image/jpeg','image/png'].includes(file?.type))return original;
  let image;
  try{
   if(file.type==='image/png'){
    const view=new DataView(await file.arrayBuffer());
    // APNG's animation control chunk precedes image data. Preserve animation.
    for(let at=8;at+12<=view.byteLength;){const size=view.getUint32(at),type=view.getUint32(at+4);if(type===0x6163544c)return original;if(type===0x49444154)break;if(size>view.byteLength-at-12)return original;at+=size+12;}
   }
   image=typeof createImageBitmap==='function'?await createImageBitmap(file):await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=original;});
   const ratio=Math.min(1,640/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));
   const ctx=canvas.getContext('2d');if(!ctx)return original;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);const encoded=canvas.toDataURL('image/webp',.9);
   return encoded.startsWith('data:image/webp;')&&encoded.length<original.length*.9?encoded:original;
  }catch{return original;}finally{image?.close?.();}
 }
 window.ProfileImageTransfer={optimize};
})();
