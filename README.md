#  微信小程序 gif 的相关操作


代码由 libgif.js 以及 gif.worker.js 源码修改，适合于微信小程序端的解决方案。

### 解码gif
```javascript
import S_GIF from '@/utils/libgif'
let decoder = new S_GIF();
.....
wx.request({
url:"https://www.abc.gif",
 responseType:"arraybuffer"
}).then(res=>decoder.load_raw(res[1]['data'],(gifs,frames)=>{
  
  console.log({frames});
  // frames 内数据结构 
  // {data:[0,0,0,255,0,0,0,255,0,0,0,255.....],delay:10}
}))

```
### 编码gif
```javascript
import util from '@/utils/util.js
const gworker =  wx.createWorker('workers/gif.worker.js');
const tasks=[];
const newData = [];
frames.forEach((item,index)=>{
    tasks.push({
       index,
       data:item.data
       last: index === frames.length - 1,
       delay: item.delay*10,
       width:item.w,
       height:item.h,
       quality:10,
       debug: false,
       dither: true,
       transparent:true,
       globalPalette:false,
       repeat:0,
       background:"#000000",
       canTransfer:true
       })
     gworker.postMessage(tasks[index]);
 });
 gworker.onMessage(item=>{
   newData.push(item);
   if(newData.length == tasks.length){
     //排序。
     newData.sort((a,b)=>{
       return a.index>b.index;
     })
     let buffer = util.arrayToGif(newData);
     console.log({buffer});
   };
   //
 })
```

### chunck to ArrayBuffer
```javascript
import util from '@/utils/util.js
let buffer = util.arrayToGif(newData);

```