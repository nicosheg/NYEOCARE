// lib/scanImageViews.js
import sharp from 'sharp';

export async function makeScanRegions(page){
 const{width:W,height:H}=page;
 const full={label:'full_page',data:page.base64,y0:0,y1:H};
 // Groq accounts for each Qwen 3.8 image as roughly 2,048 input tokens.
 // Three views plus the extraction prompt/schema can exceed the 7K ITPM
 // single-request ceiling before inference starts. Use two overlapping views
 // on tall pages; keep the original full-page image in `data` as a safe,
 // lower-detail fallback if the provider rejects even this smaller request.
 if(H<900)return[{id:1,y0:0,y1:H,w:W,h:H,data:page.base64,images:[full]}];
 const cropH=Math.round(H*.62),bottomY=H-cropH,topY=0;
 const [topBuffer,bottomBuffer]=await Promise.all([
  sharp(page.buffer).extract({left:0,top:topY,width:W,height:cropH}).jpeg({quality:92,mozjpeg:true}).toBuffer(),
  sharp(page.buffer).extract({left:0,top:bottomY,width:W,height:cropH}).jpeg({quality:92,mozjpeg:true}).toBuffer()
 ]);
 const top={label:'upper_detail',data:topBuffer.toString('base64'),y0:topY,y1:topY+cropH};
 const bottom={label:'lower_detail',data:bottomBuffer.toString('base64'),y0:bottomY,y1:H};
 return[{id:1,y0:0,y1:H,w:W,h:H,data:page.base64,images:[top,bottom]}];
}
