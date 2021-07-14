/*
    你所看到的是修改后的代码。
    --by shinku --
    原始的 gifjs 的地址为：https://github.com/kelyvin/libgif-js

	Constructor options args

		gif 				Required. The DOM element of an img tag.
		loop_mode			Optional. Setting this to false will force disable looping of the gif.
		auto_play 			Optional. Same as the rel:auto_play attribute above, this arg overrides the img tag info.
		max_width			Optional. Scale images over max_width down to max_width. Helpful with mobile.
 		on_end				Optional. Add a callback for when the gif reaches the end of a single loop (one iteration). The first argument passed will be the gif HTMLElement.
		loop_delay			Optional. The amount of time to pause (in ms) after each single loop (iteration).
		draw_while_loading	Optional. Determines whether the gif will be drawn to the canvas whilst it is loaded.
		show_progress_bar	Optional. Only applies when draw_while_loading is set to true.

	Instance methods

		// loading
		load( callback )		Loads the gif specified by the src or rel:animated_src sttributie of the img tag into a canvas element and then calls callback if one is passed
		load_url( src, callback )	Loads the gif file specified in the src argument into a canvas element and then calls callback if one is passed

		// play controls
		play -				Start playing the gif
		pause -				Stop playing the gif
		move_to(i) -		Move to frame i of the gif
		move_relative(i) -	Move i frames ahead (or behind if i < 0)

		// getters
		get_canvas			The canvas element that the gif is playing in. Handy for assigning event handlers to.
		get_playing			Whether or not the gif is currently playing
		get_loading			Whether or not the gif has finished loading/parsing
		get_auto_play		Whether or not the gif is set to play automatically
		get_length			The number of frames in the gif
		get_current_frame	The index of the currently displayed frame of the gif
		get_frames	        An array containing the data for all parsed frames
		get_duration	    Returns the duration of the gif in hundredths of a second (standard for GIF spec)
		get_duration_ms	    Returns the duration of the gif in milliseconds

		For additional customization (viewport inside iframe) these params may be passed:
		c_w, c_h - width and height of canvas
		vp_t, vp_l, vp_ w, vp_h - top, left, width and height of the viewport

		A bonus: few articles to understand what is going on
			http://enthusiasms.org/post/16976438906
			http://www.matthewflickinger.com/lab/whatsinagif/bits_and_bytes.asp
			http://humpy77.deviantart.com/journal/Frame-Delay-Times-for-Animated-GIFs-214150546

*/

function ImageData(array,_w,_h){
    this.data = array;
    this.width = _w;
    this.height = _h;
    this.clone = function (){
        return new ImageData(this.data,this.width,this.height);
    }
}

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.SuperGif = factory();
    }
}(this, function () {
    // Generic functions
    var bitsToNum = function (ba) {
        return ba.reduce(function (s, n) {
            return s * 2 + n;
        }, 0);
    };

    var byteToBitArr = function (bite) {
        var a = [];
        for (var i = 7; i >= 0; i--) {
            a.push( !! (bite & (1 << i)));
        }
        return a;
    };

    // Stream
    /**
     * @constructor
     */
    // Make compiler happy.
    var Stream = function (data) {
        this.data = data;
        this.len = this.data.length;
        this.pos = 0;

        this.readByte = function () {
            if (this.pos >= this.data.length) {
                throw new Error('Attempted to read past end of stream.');
            }
            //console.log(data);
            if(data instanceof ArrayBuffer){
                data = new Uint8Array(data)
            }
            if (data instanceof Uint8Array || data instanceof ArrayBuffer)
            {
                //console.log(data[0]);
                return data[this.pos++];
            }
            
            else
            {
                
                return data.charCodeAt(this.pos++) & 0xFF;
            }
                
        };

        this.readBytes = function (n) {
            var bytes = [];
            for (var i = 0; i < n; i++) {
                bytes.push(this.readByte());
            }
            return bytes;
        };

        this.read = function (n) {

            var s = '';
            
            for (var i = 0; i < n; i++) {
                let strByte = this.readByte();
                //console.log({strByte});
                s += String.fromCharCode(strByte);
            }
            
            return s;
        };

        this.readUnsigned = function () { // Little-endian.
           
            var a = this.readBytes(2);
            return (a[1] << 8) + a[0];
        };
    };

    var lzwDecode = function (minCodeSize, data) {
        // TODO: Now that the GIF parser is a bit different, maybe this should get an array of bytes instead of a String?
        var pos = 0; // Maybe this streaming thing should be merged with the Stream?
        var readCode = function (size) {
            var code = 0;
            for (var i = 0; i < size; i++) {
                if (data.charCodeAt(pos >> 3) & (1 << (pos & 7))) {
                    code |= 1 << i;
                }
                pos++;
            }
            return code;
        };

        var output = [];

        var clearCode = 1 << minCodeSize;
        var eoiCode = clearCode + 1;

        var codeSize = minCodeSize + 1;

        var dict = [];

        var clear = function () {
            dict = [];
            codeSize = minCodeSize + 1;
            for (var i = 0; i < clearCode; i++) {
                dict[i] = [i];
            }
            dict[clearCode] = [];
            dict[eoiCode] = null;

        };

        var code;
        var last;

        while (true) {
            last = code;
            code = readCode(codeSize);

            if (code === clearCode) {
                clear();
                continue;
            }
            if (code === eoiCode) break;

            if (code < dict.length) {
                if (last !== clearCode) {
                    dict.push(dict[last].concat(dict[code][0]));
                }
            }
            else {
                if (code !== dict.length) throw new Error('Invalid LZW code.');
                dict.push(dict[last].concat(dict[last][0]));
            }
            output.push.apply(output, dict[code]);

            if (dict.length === (1 << codeSize) && codeSize < 12) {
                // If we're at the last code and codeSize is 12, the next code will be a clearCode, and it'll be 12 bits long.
                codeSize++;
            }
        }

        // I don't know if this is technically an error, but some GIFs do it.
        //if (Math.ceil(pos / 8) !== data.length) throw new Error('Extraneous LZW bytes.');
        return output;
    };


    // The actual parsing; returns an object with properties.
    var parseGIF = function (st, handler) {
        handler || (handler = {});
        //console.log('parseGIF now');
        // LZW (GIF-specific)
        var parseCT = function (entries) { // Each entry is 3 bytes, for RGB.
            var ct = [];
            for (var i = 0; i < entries; i++) {
                ct.push(st.readBytes(3));
            }
            return ct;
        };

        var readSubBlocks = function () {
            var size, data;
            data = '';
            do {
                size = st.readByte();
                data += st.read(size);
            } while (size !== 0);
            return data;
        };

        var parseHeader = function () {
            //console.log(2,st);
            var hdr = {};
            hdr.sig = st.read(3);
            hdr.ver = st.read(3);
          
            
            if (hdr.sig !== 'GIF') throw new Error('Not a GIF file.'); // XXX: This should probably be handled more nicely.
            hdr.width = st.readUnsigned();
            hdr.height = st.readUnsigned();
           
            var bits = byteToBitArr(st.readByte());
            hdr.gctFlag = bits.shift();
            hdr.colorRes = bitsToNum(bits.splice(0, 3));
            hdr.sorted = bits.shift();
            hdr.gctSize = bitsToNum(bits.splice(0, 3));

            hdr.bgColor = st.readByte();
            hdr.pixelAspectRatio = st.readByte(); // if not 0, aspectRatio = (pixelAspectRatio + 15) / 64
            if (hdr.gctFlag) {
                hdr.gct = parseCT(1 << (hdr.gctSize + 1));
            }
            //console.log({handler,hdr,frames});
            //return;
           
            if(handler.hdr){
                //console.log(565656565);
                //console.log({handler},handler.hdr)
                handler.hdr(hdr);
            }
           
        };

        var parseExt = function (block) {
            var parseGCExt = function (block) {
                var blockSize = st.readByte(); // Always 4
                var bits = byteToBitArr(st.readByte());
                block.reserved = bits.splice(0, 3); // Reserved; should be 000.
                block.disposalMethod = bitsToNum(bits.splice(0, 3));
                block.userInput = bits.shift();
                block.transparencyGiven = bits.shift();

                block.delayTime = st.readUnsigned();

                block.transparencyIndex = st.readByte();

                block.terminator = st.readByte();

                handler.gce && handler.gce(block);
            };

            var parseComExt = function (block) {
                block.comment = readSubBlocks();
                handler.com && handler.com(block);
            };

            var parsePTExt = function (block) {
                // No one *ever* uses this. If you use it, deal with parsing it yourself.
                var blockSize = st.readByte(); // Always 12
                block.ptHeader = st.readBytes(12);
                block.ptData = readSubBlocks();
                handler.pte && handler.pte(block);
            };

            var parseAppExt = function (block) {
                var parseNetscapeExt = function (block) {
                    var blockSize = st.readByte(); // Always 3
                    block.unknown = st.readByte(); // ??? Always 1? What is this?
                    block.iterations = st.readUnsigned();
                    block.terminator = st.readByte();
                    handler.app && handler.app.NETSCAPE && handler.app.NETSCAPE(block);
                };

                var parseUnknownAppExt = function (block) {
                    block.appData = readSubBlocks();
                    // FIXME: This won't work if a handler wants to match on any identifier.
                    handler.app && handler.app[block.identifier] && handler.app[block.identifier](block);
                };

                var blockSize = st.readByte(); // Always 11
                block.identifier = st.read(8);
                block.authCode = st.read(3);
                switch (block.identifier) {
                    case 'NETSCAPE':
                        parseNetscapeExt(block);
                        break;
                    default:
                        parseUnknownAppExt(block);
                        break;
                }
            };

            var parseUnknownExt = function (block) {
                block.data = readSubBlocks();
                handler.unknown && handler.unknown(block);
            };

            block.label = st.readByte();
            switch (block.label) {
                case 0xF9:
                    block.extType = 'gce';
                    parseGCExt(block);
                    break;
                case 0xFE:
                    block.extType = 'com';
                    parseComExt(block);
                    break;
                case 0x01:
                    block.extType = 'pte';
                    parsePTExt(block);
                    break;
                case 0xFF:
                    block.extType = 'app';
                    parseAppExt(block);
                    break;
                default:
                    block.extType = 'unknown';
                    parseUnknownExt(block);
                    break;
            }
        };

        var parseImg = function (img) {
            var deinterlace = function (pixels, width) {
                // Of course this defeats the purpose of interlacing. And it's *probably*
                // the least efficient way it's ever been implemented. But nevertheless...
                var newPixels = new Array(pixels.length);
                var rows = pixels.length / width;
                var cpRow = function (toRow, fromRow) {
                    var fromPixels = pixels.slice(fromRow * width, (fromRow + 1) * width);
                    newPixels.splice.apply(newPixels, [toRow * width, width].concat(fromPixels));
                };

                // See appendix E.
                var offsets = [0, 4, 2, 1];
                var steps = [8, 8, 4, 2];

                var fromRow = 0;
                for (var pass = 0; pass < 4; pass++) {
                    for (var toRow = offsets[pass]; toRow < rows; toRow += steps[pass]) {
                        cpRow(toRow, fromRow)
                        fromRow++;
                    }
                }

                return newPixels;
            };

            img.leftPos = st.readUnsigned();
            img.topPos = st.readUnsigned();
         
            img.width = st.readUnsigned();
            img.height = st.readUnsigned();
            //console.log(img.width,img.height);
            var bits = byteToBitArr(st.readByte());
            img.lctFlag = bits.shift();
            img.interlaced = bits.shift();
            img.sorted = bits.shift();
            img.reserved = bits.splice(0, 2);
            img.lctSize = bitsToNum(bits.splice(0, 3));

            if (img.lctFlag) {
                img.lct = parseCT(1 << (img.lctSize + 1));
            }

            img.lzwMinCodeSize = st.readByte();

            var lzwData = readSubBlocks();

            img.pixels = lzwDecode(img.lzwMinCodeSize, lzwData);

            if (img.interlaced) { // Move
                img.pixels = deinterlace(img.pixels, img.width);
            }

            handler.img && handler.img(img);
        };

        var parseBlock = function () {
            var block = {};
            block.sentinel = st.readByte();
           
            switch (String.fromCharCode(block.sentinel)) { // For ease of matching
                case '!':
                    block.type = 'ext';
                    parseExt(block);
                    break;
                case ',':
                    block.type = 'img';
                    parseImg(block);
                    break;
                case ';':
                    block.type = 'eof';
                    handler.eof && handler.eof(block);
                    break;
                default:
                    throw new Error('Unknown block: 0x' + block.sentinel.toString(16)); // TODO: Pad this with a 0.
            }
          
            if (block.type !== 'eof') setTimeout(parseBlock, 0);
        };

        var parse = function () {
            parseHeader();
            setTimeout(parseBlock, 0);
        };

        parse();
    };

    var SuperGif = function ( opts ) {
        var options = {
            //viewport position
            vp_l: 0,
            vp_t: 0,
            vp_w: null,
            vp_h: null,
            //canvas sizes
            c_w: null,
            c_h: null
        };
        //for (var i in opts ) { options[i] = opts[i] }
        if (options.vp_w && options.vp_h) options.is_vp = true;

        var stream;
        var hdr;

        var loadError = null;
        var loading = false;

        var transparency = null;
        var delay = null;
        var disposalMethod = null;
        var disposalRestoreFromIdx = null;
        var lastDisposalMethod = null;
        var frame = null;
        var lastImg = null;

        var playing = true;
        var forward = true;

        var ctx_scaled = false;

        var frames = [];
        var base64Urls = [];
        var frameOffsets = []; // elements have .x and .y properties

        var gif = options.gif;
        // if (typeof options.auto_play == 'undefined')
        // options.auto_play = (!gif.getAttribute('rel:auto_play') || gif.getAttribute('rel:auto_play') == '1');
        options.auto_play = options.auto_play || true;
        var onEndListener = (options.hasOwnProperty('on_end') ? options.on_end : null);
        var loopDelay = (options.hasOwnProperty('loop_delay') ? options.loop_delay : 0);
        var overrideLoopMode = (options.hasOwnProperty('loop_mode') ? options.loop_mode : 'auto');
        var drawWhileLoading = (options.hasOwnProperty('draw_while_loading') ? options.draw_while_loading : true);
        var showProgressBar = drawWhileLoading ? (options.hasOwnProperty('show_progress_bar') ? options.show_progress_bar : true) : false;
        var progressBarHeight = (options.hasOwnProperty('progressbar_height') ? options.progressbar_height : 25);
        var progressBarBackgroundColor = (options.hasOwnProperty('progressbar_background_color') ? options.progressbar_background_color : 'rgba(255,255,255,0.4)');
        var progressBarForegroundColor = (options.hasOwnProperty('progressbar_foreground_color') ? options.progressbar_foreground_color : 'rgba(255,0,22,.8)');

        var clear = function () {
            transparency = null;
            delay = null;
            lastDisposalMethod = disposalMethod;
            disposalMethod = null;
            frame = null;
        };

        // XXX: There's probably a better way to handle catching exceptions when
        // callbacks are involved.
        var doParse = function () {
          
            try {
                parseGIF(stream, handler);
            }
            catch (err) {
                doLoadError('parse');
            }
        };

        var doText = function (text) {
            toolbar.innerHTML = text; // innerText? Escaping? Whatever.
            toolbar.style.visibility = 'visible';
        };

        var setSizes = function(w, h) {
           
            try{
               
            }catch(e)
            {
                console.log({e})
            }            
        };

        var setFrameOffset = function(frame, offset) {
            if (!frameOffsets[frame]) {
                frameOffsets[frame] = offset;
                return;
            }
            if (typeof offset.x !== 'undefined') {
                frameOffsets[frame].x = offset.x;
            }
            if (typeof offset.y !== 'undefined') {
                frameOffsets[frame].y = offset.y;
            }
        };

        var doShowProgress = function (pos, length, draw) {
            if(!canvas) return;
        
            if (draw && showProgressBar) {
                var height = progressBarHeight;
                var left, mid, top, width;
                if (options.is_vp) {
                    if (!ctx_scaled) {
                        top = (options.vp_t + options.vp_h - height);
                        height = height;
                        left = options.vp_l;
                        mid = left + (pos / length) * options.vp_w;
                        width = canvas.width;
                    } else {
                        top = (options.vp_t + options.vp_h - height) / get_canvas_scale();
                        height = height / get_canvas_scale();
                        left = (options.vp_l / get_canvas_scale() );
                        mid = left + (pos / length) * (options.vp_w / get_canvas_scale());
                        width = canvas.width / get_canvas_scale();
                    }
                    //some debugging, draw rect around viewport
                    if (false) {
                    
                    }
                }
                else {
                    top = (canvas.height - height) / (ctx_scaled ? get_canvas_scale() : 1);
                    mid = ((pos / length) * canvas.width) / (ctx_scaled ? get_canvas_scale() : 1);
                    width = canvas.width / (ctx_scaled ? get_canvas_scale() : 1 );
                    height /= ctx_scaled ? get_canvas_scale() : 1;
                }

                ctx.fillStyle = progressBarBackgroundColor;
                ctx.fillRect(mid, top, width - mid, height);

                ctx.fillStyle = progressBarForegroundColor;
                ctx.fillRect(0, top, mid, height);
            }
        };

        var doLoadError = function (originOfError) {
            var drawError = function () {
                return;
             
            };

            loadError = originOfError;
            hdr = {
                width: gif.width,
                height: gif.height
            }; // Fake header.
            frames = [];
            drawError();
        };

        var doHdr = function (_hdr) {
           
            hdr = _hdr;
            setSizes(hdr.width, hdr.height)
           
        };

        var doGCE = function (gce) {
            pushFrame();
            clear();
            transparency = gce.transparencyGiven ? gce.transparencyIndex : null;
            delay = gce.delayTime;
            disposalMethod = gce.disposalMethod;
            // We don't have much to do with the rest of GCE.
        };

        var pushFrame = function () {
           
            
            if(tempDatas)
            {
                //console.log(img.width,img.height, img);
                let data = tempDatas;
                frames.push({
                    //data: frame.getImageData(0, 0, hdr.width, hdr.height),
                    data,
                    delay: delay,
                    w: hdr.width,
                    h: hdr.height
                });
                frameOffsets.push({ x: 0, y: 0 });
                //base64Urls.push(tmpCanvas.toDataURL())
            }
               
           
            
           
        };
        var temp_image_data = null;
        var doImg = function (img) {
            var currIdx = frames.length;
            var ct = img.lctFlag ? img.lct : hdr.gct; // TODO: What if neither exists?
           
            /*
            Disposal method indicates the way in which the graphic is to
            be treated after being displayed.

            Values :    0 - No disposal specified. The decoder is
                            not required to take any action.
                        1 - Do not dispose. The graphic is to be left
                            in place.
                        2 - Restore to background color. The area used by the
                            graphic must be restored to the background color.
                        3 - Restore to previous. The decoder is required to
                            restore the area overwritten by the graphic with
                            what was there prior to rendering the graphic.

                            Importantly, "previous" means the frame state
                            after the last disposal of method 0, 1, or 2.
            */
            //console.log({currIdx})
            //if(currIdx >1) return;
            if (currIdx > 0) {
              
                //console.log(0)
                if (lastDisposalMethod === 3) {
                  
                    // Restore to previous
                    // If we disposed every frame including first frame up to this point, then we have
                    // no composited frame to restore to. In this case, restore to background instead.
                    if (disposalRestoreFromIdx !== null) {
                      
                    	//frame.putImageData(frames[disposalRestoreFromIdx].data, 0, 0);
                    } else {
                     
                    	//frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
                    }
                } else {
                    //console.log(6)
                    disposalRestoreFromIdx = currIdx - 1;
                }
                if (lastDisposalMethod === 2) {
                    
                    // Restore to background color
                    // Browser implementations historically restore to transparent; we do the same.
                    // http://www.wizards-toolkit.org/discourse-server/viewtopic.php?f=1&t=21172#p86079
                    //frame.clearRect(lastImg.leftPos, lastImg.topPos, lastImg.width, lastImg.height);
                }
            }
            // else, Undefined/Do not dispose.
            // frame contains final pixel data from the last frame; do nothing

            //Get existing pixels for img region after applying disposal method
            //var imgData = frame.getImageData(img.leftPos, img.topPos, img.width, img.height);
            //var _imgData = new ImageData(img.width,img.height)
            //apply color table colors
            //console.log(uni.createOffscreenCanvas.createImageData(img.leftPos, img.topPos, img.width, img.height))
            //console.log(img.leftPos, img.topPos, img.width, img.height);
           
          
            //console.log(_data);
            if(!temp_image_data) {
                temp_image_data = new Uint8ClampedArray(hdr.width*hdr.height*4);
                //console.log(img.pixels.length);
            }
           
            let datacopy = Uint8ClampedArray.from(temp_image_data);
            var w = hdr.width;
            var h = hdr.height;
            
           
           
            img.pixels.forEach(function (pixel, i) {
                // imgData.data === [R,G,B,A,R,G,B,A,...]
                
                if (pixel !== transparency) {
                    /*imgData.data[i * 4 + 0] = ct[pixel][0];
                    imgData.data[i * 4 + 1] = ct[pixel][1];
                    imgData.data[i * 4 + 2] = ct[pixel][2];
                    imgData.data[i * 4 + 3] = 255; // Opaque.
                    */
                    //tempDatas
                    /*_data[i * 4 + 0] = ct[pixel][0];
                    _data[i * 4 + 1] = ct[pixel][1];
                    _data[i * 4 + 2] = ct[pixel][2];
                    _data[i * 4 + 3] = 255; // Opaque.*/
                    //tempDatas = _imgData;
                    
                    var main_left_px = i%img.width + img.leftPos;
                    var main_top_px = ((i/img.width)>>0) + img.topPos;

                    //h = main_top_px;
                    
                    var pix_index_from = main_top_px*w+main_left_px;

                    //temp_image_data[]
                    //console.log({pix_index_from})
                    datacopy[pix_index_from*4] = ct[pixel][0];
                    datacopy[pix_index_from*4+1] = ct[pixel][1];
                    datacopy[pix_index_from*4+2] = ct[pixel][2];
                    datacopy[pix_index_from*4+3] = 255;
                    //console.log(pix_index_from);
                    //console.log(pix_index_from);
                    
                }
            });
           

            tempDatas = new ImageData(datacopy,hdr.width, hdr.height);
            temp_image_data = datacopy;
            //console.log(datacopy.length);
            
            if (drawWhileLoading) {
                //console.log({tmpCanvas})
                //ctx.drawImage(tmpCanvas, 0, 0);
                //ctx.putImageData(imgData, img.leftPos, img.topPos);
                drawWhileLoading = options.auto_play;
            }
            //console.log({currIdx})
            if(handler.onProgress) handler.onProgress.call(null)
            lastImg = img;
        };

        var player = (function () {
            var i = -1;
            var iterationCount = 0;

            var showingInfo = false;
            var pinned = false;

            /**
             * Gets the index of the frame "up next".
             * @returns {number}
             */
            var getNextFrameNo = function () {
                var delta = (forward ? 1 : -1);
                return (i + delta + frames.length) % frames.length;
            };

            var stepFrame = function (amount) { // XXX: Name is confusing.
                i = i + amount;
                //console.log(i);
                putFrame();
            };

            var step = (function () {
                var stepping = false;

                var completeLoop = function () {
                    if (onEndListener !== null)
                        onEndListener(gif);
                    iterationCount++;

                    if (overrideLoopMode !== false || iterationCount < 0) {
                        doStep();
                    } else {
                        stepping = false;
                        playing = false;
                    }
                };

                var doStep = function () {
                    stepping = playing;
                    if (!stepping) return;

                    stepFrame(1);
                    var delay = frames[i].delay * 10;
                    if (!delay) delay = 100; // FIXME: Should this even default at all? What should it be?

                    var nextFrameNo = getNextFrameNo();
                    if (nextFrameNo === 0) {
                        delay += loopDelay;
                        setTimeout(completeLoop, delay);
                    } else {
                        setTimeout(doStep, delay);
                    }
                };

                return function () {
                    if (!stepping) setTimeout(doStep, 0);
                };
            }());

            var putFrame = function () {
                var offset;
                i = parseInt(i, 10);

                if (i > frames.length - 1){
                    i = 0;
                }

                if (i < 0){
                    i = 0;
                }

                offset = frameOffsets[i];
                //tmpCanvas.getContext("2d").putImageData(frames[i].data, offset.x, offset.y);
                //ctx.globalCompositeOperation = "copy";
                //ctx.drawImage(tmpCanvas, 0, 0);
               
                //ctx.putImageData(frames[i].data, offset.x, offset.y);
            };

            var play = function () {
                playing = true;
                step();
            };

            var pause = function () {
                playing = false;
            };


            return {
                init: function () {
                    if (loadError) return;

                    if ( ! (options.c_w && options.c_h) ) {
                        //ctx.scale(get_canvas_scale(),get_canvas_scale());
                    }

                    if (options.auto_play) {
                        step();
                    }
                    else {
                        i = 0;
                        putFrame();
                    }
                },
                step: step,
                play: play,
                pause: pause,
                playing: playing,
                move_relative: stepFrame,
                current_frame: function() { return i; },
                length: function() { return frames.length },
                move_to: function ( frame_idx ) {
                    i = frame_idx;
                    putFrame();
                }
            }
        }());

        var doDecodeProgress = function (draw) {
            doShowProgress(stream.pos, stream.data.length, draw);
        };

        var doNothing = function () {};
        /**
         * @param{boolean=} draw Whether to draw progress bar or not; this is not idempotent because of translucency.
         *                       Note that this means that the text will be unsynchronized with the progress bar on non-frames;
         *                       but those are typically so small (GCE etc.) that it doesn't really matter. TODO: Do this properly.
         */
        var withProgress = function (fn, draw) {
            
            return function (block) {
                fn(block);
                //console.log('www')
                doDecodeProgress(draw);
            };
        };


        var handler = {
            hdr: withProgress(doHdr),
            gce: withProgress(doGCE),
            com: withProgress(doNothing),
            // I guess that's all for now.
            app: {
                // TODO: Is there much point in actually supporting iterations?
                NETSCAPE: withProgress(doNothing)
            },
            img: withProgress(doImg, true),
            eof: function (block) {
                //toolbar.style.display = '';

                pushFrame();
                doDecodeProgress(false);
                if ( ! (options.c_w && options.c_h) ) {
                    //hdr.canvasw = hdr.width*
                    //hdr.canvasw = hdr.width * get_canvas_scale();
                    //hdr.canvash = hdr.height * get_canvas_scale();
                }
                player.init();
                loading = false;
                //console.log({gif,frames})
                if (load_callback) {
                    let {
                        width,height
                    } = hdr;

                    load_callback(gif,{frames,frameOffsets, width,height,scale:get_canvas_scale()});
                }

            }
        };
        var tempDatas = null;
        var init = function (callback) {
           
            var parent = gif.parentNode;
            //if(document && document.createElement){
             //   canvas = document.createElement('canvas');
             //   tmpCanvas = document.createElement('canvas');
            //}

            //else{

                //canvas = uni.createOffscreenCanvas();
                //tmpCanvas = uni.createOffscreenCanvas();
            //}
          

            initialized=true;
            callback();
            return;
           
        };

        var get_canvas_scale = function() {
            var scale;
            if (options.max_width && hdr && hdr.width > options.max_width) {
                scale = options.max_width / hdr.width;
            }
            else {
                scale = 1;
            }
            return scale;
        }

        var canvas, ctx, toolbar, tmpCanvas;
        var initialized = false;
        var load_callback = false;

        var load_setup = function(callback) {
            if (loading) return false;
            if (callback) load_callback = callback;
            else load_callback = false;

            loading = true;
            frames = [];
            clear();
            disposalRestoreFromIdx = null;
            lastDisposalMethod = null;
            frame = null;
            lastImg = null;

            return true;
        }

        var calculateDuration = function() {
            return frames.reduce(function(duration, frame) {
                return duration + frame.delay;
            }, 0);
        }

        return {
            // play controls
            play: player.play,
            pause: player.pause,
            move_relative: player.move_relative,
            move_to: player.move_to,

            // getters for instance vars
            get_playing      : function() { return playing },
            get_canvas       : function() { return canvas },
            get_canvas_scale : function() { return get_canvas_scale() },
            get_loading      : function() { return loading },
            get_auto_play    : function() { return options.auto_play },
            get_length       : function() { return player.length() },
            get_frames       : function() { return frames },
            get_duration     : function() { return calculateDuration() },
            get_duration_ms  : function() { return calculateDuration() * 10 },
            get_current_frame: function() { return player.current_frame() },
            load_url: function(src,callback){
                if (!load_setup(callback)) return;

                var h = new XMLHttpRequest();
                // new browsers (XMLHttpRequest2-compliant)
                h.open('GET', src, true);

                if ('overrideMimeType' in h) {
                    h.overrideMimeType('text/plain; charset=x-user-defined');
                }

                // old browsers (XMLHttpRequest-compliant)
                else if ('responseType' in h) {
                    h.responseType = 'arraybuffer';
                }

                // IE9 (Microsoft.XMLHTTP-compliant)
                else {
                    h.setRequestHeader('Accept-Charset', 'x-user-defined');
                }

                h.onloadstart = function() {
                    // Wait until connection is opened to replace the gif element with a canvas to avoid a blank img
                    if (!initialized) init();
                };
                h.onload = function(e) {
                    if (this.status != 200) {
                        doLoadError('xhr - response');
                    }
                    // emulating response field for IE9
                    if (!('response' in this)) {
                        this.response = new VBArray(this.responseText).toArray().map(String.fromCharCode).join('');
                    }
                    var data = this.response;
                    if (data.toString().indexOf("ArrayBuffer") > 0) {
                        data = new Uint8Array(data);
                    }

                    stream = new Stream(data);
                    setTimeout(doParse, 0);
                };
                h.onprogress = function (e) {
                    if (e.lengthComputable) doShowProgress(e.loaded, e.total, true);
                };
                h.onerror = function() { doLoadError('xhr'); };
                h.send();
            },
            load: function (callback) {
                //this.load_url(gif.getAttribute('rel:animated_src') || gif.src,callback);
            },
            load_raw: function(arr, callback,onProgress) {
                if (!load_setup(callback)) return;
                if (!initialized) init(function(){
                    stream = new Stream(arr);
                    setTimeout(doParse, 0);
                });
                handler.onProgress = onProgress || function(){}
               
            },
            set_frame_offset: setFrameOffset
        };
    };

    return SuperGif;
}));


