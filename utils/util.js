export default {

    arrayToGif(framespart){
        //console.log('arrayToGif',framespart);
        /*framespart.sort((a,b)=>{
            return a.index > b.index;
        });*/
        let len =0;
        let len1,j,k,len2,len3,i,l,page,frame=0;
        let ref1,ref2 =[];
        let ref = framespart;
        for (j = 0, len1 = ref.length; j < len1; j++) {
            frame = ref[j];
            len += (frame.data.length - 1) * frame.pageSize + frame.cursor
        };
        len += frame.pageSize - frame.cursor;
        let lastdata = new Uint8Array(len);
        let offset = 0;
        ref1 = framespart;
        for (k = 0, len2 = ref1.length; k < len2; k++) {
            frame = ref1[k];
            ref2 = frame.data;
            for (i = l = 0, len3 = ref2.length; l < len3; i = ++l) {
                page = ref2[i];
                let arr = Object.values(page).map(item=>item);
                //console.log(arr,offset)
                lastdata.set(arr, offset);
                if (i === frame.data.length - 1) {
                    offset += frame.cursor
                } else {
                    offset += frame.pageSize
                }
            }
        }
        let buffer = new ArrayBuffer(lastdata.length);
        let u8data = new Uint8Array(buffer);
        lastdata.forEach((a,index)=>u8data[index]=a);
        //console.log(buffer);
        lastdata = null;
        return buffer;
    },
    makeTasks(_frames){
     
    }
}