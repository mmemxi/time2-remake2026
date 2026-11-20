var xctbl="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@*";
var ckmode=false;
var ctt;
var cps;
ctt=new Date;
ctt.setTime(ctt.getTime() + 1000 * 60 * 60 * 24 * 60);

var SAVE_SLOT_COUNT=60;
var SAVE_KEY_PREFIX="Time2:Save:";

function save(){top.openSaveManager("save");}
function load(){top.openSaveManager("load");}

async function getSaveSlots()
{
var localSlots=[];
for(var slot=1;slot<=SAVE_SLOT_COUNT;slot++)
	{
	var raw=localStorage.getItem(SAVE_KEY_PREFIX+slot);
	if(raw==null){localSlots.push(null);continue;}
	try{localSlots.push(JSON.parse(raw));}catch(error){localSlots.push(null);}
	}
try
	{
	var response=await fetch("../api/saves",{cache:"no-store"});
	if(!response.ok) throw new Error("save API unavailable");
	var serverSlots=await response.json();
	for(var index=0;index<SAVE_SLOT_COUNT;index++)
		{
		if(serverSlots[index]) localStorage.setItem(SAVE_KEY_PREFIX+(index+1),JSON.stringify(serverSlots[index]));
		else localStorage.removeItem(SAVE_KEY_PREFIX+(index+1));
		}
	return serverSlots;
	}
catch(error){return localSlots;}
}

async function saveSlot(slot)
{
slot=parseInt(slot,10);
if(slot<1||slot>SAVE_SLOT_COUNT) return false;
savenow();
var record={
	version:2,
	pwd:ftoc(),
	savedAt:new Date().toISOString(),
	page:page,
	line:line,
	state:(top.MAIN&&typeof top.MAIN.exportScenarioState==="function")?top.MAIN.exportScenarioState():null,
	textResume:(top.TEXT&&typeof top.TEXT.exportTextResumeState==="function")?top.TEXT.exportTextResumeState():null,
	sceneLabel:"",
	thumbnail:await captureScene()
	};
if(record.state)
	{
	var locationLabel=record.state.sceneName||("シーン"+record.page);
	var positionLabel=record.state.posName||("場面"+record.line);
	record.sceneLabel=locationLabel+" / "+positionLabel;
	}
try{localStorage.setItem(SAVE_KEY_PREFIX+slot,JSON.stringify(record));}
catch(error){await top.showGameAlert("セーブ領域の空き容量が不足しています。","セーブできません");return false;}
try
	{
	var response=await fetch("../api/saves/"+slot,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(record)});
	if(!response.ok) throw new Error("save API failed");
	}
catch(error){}
return true;
}

async function loadSlot(slot)
{
slot=parseInt(slot,10);
var slots=await getSaveSlots();
if(!slots[slot-1]) return false;
var raw=JSON.stringify(slots[slot-1]);
try
	{
	var record=JSON.parse(raw);
	if(Number(record.version)!==2||!record.state)
		{
		await top.showGameAlert("このセーブデータは従来HTML版のものです。TXTシナリオ版では読み込めません。","旧バージョンのセーブデータ");
		return false;
		}
	if(!record.pwd||ctof(record.pwd)==false) return false;
	top.stopVoice();
	resetMessageHistory();
	drawcnt=0;url_bgm="---";clr();
	top.bonusMode=false;
	if(top.MAIN&&typeof top.MAIN.importScenarioState==="function") top.MAIN.importScenarioState(record.state);
if(top.MAIN&&typeof top.MAIN.runLocation==="function") top.MAIN.runLocation(page,line,{suppressSceneTitle:true,suppressItemFlash:true,suppressScenarioSoundEffects:true,suppressShake:true,textResume:record.textResume||null});
	else goit(page,line);
	top.hideTitleScreen();
	return true;
	}
catch(error){return false;}
}

async function captureScene()
{
var canvas=document.createElement("canvas");
var remakeMode=top.gameMode==="remake";
var verticalScale=remakeMode?0.75:1;
canvas.width=400;canvas.height=remakeMode?225:300;
var context=canvas.getContext("2d");
context.fillStyle="#000";context.fillRect(0,0,canvas.width,canvas.height);
for(var layerIndex=1;layerIndex<=gcnt;layerIndex++)
	{
	var folder=/\.gif$/i.test(lgrp[layerIndex])?"gif":"jpg";
	try
		{
		var image=await loadPreferredSceneImage(lgrp[layerIndex],folder,remakeMode);
		if(remakeMode&&folder==="gif")
			{
			var standingHeight=canvas.height;
			var standingWidth=image.naturalWidth*(standingHeight/image.naturalHeight);
			context.drawImage(image,lx[layerIndex],0,standingWidth,standingHeight);
			}
		else context.drawImage(image,lx[layerIndex],ly[layerIndex]*verticalScale,lxs[layerIndex],lys[layerIndex]*verticalScale);
		}
	catch(error){}
	}
return canvas.toDataURL("image/jpeg",0.58);
}

async function loadPreferredSceneImage(name,folder,remakeMode)
{
if(remakeMode)
	{
	var remakeName=folder==="gif"?name.replace(/\.gif$/i,".png"):name;
	if(top.nekomimiMode)
		{
		var nekomimiFolder=folder==="gif"?"ngif":"njpg";
		try{return await loadSceneImage("../resource/remake/"+nekomimiFolder+"/"+remakeName);}catch(error){}
		}
	try{return await loadSceneImage("../resource/remake/"+folder+"/"+remakeName);}catch(error){}
	}
return loadSceneImage("../resource/original/"+folder+"/"+name);
}

function loadSceneImage(source)
{
return new Promise(function(resolve,reject)
	{
	var image=new Image();
	image.onload=function(){resolve(image);};
	image.onerror=reject;
	var separator=source.indexOf("?")===-1?"?":"&";
	image.src=source+separator+"v="+encodeURIComponent(top.sceneAssetVersion||Date.now());
	});
}

function csave(section,data)
{
localStorage.setItem("MakiScript:"+section, data);
}

function cload(section,data)
{
var stored=localStorage.getItem("MakiScript:"+section);
if (stored!==null) {
  var match=stored.match(new RegExp("\\("+data+":([^)]*)\\)"));
  return match ? match[1] : null;
}
var stt=0;
var end=0;
var len=0;
var gets="";
var secs="";

stt=document.cookie.indexOf(section,0);
if (stt==-1) return null;
len=section.length;
end=document.cookie.indexOf("/",stt);
stt=stt+len+1;
gets=document.cookie.substring(stt,end);

data="("+data;
stt=gets.indexOf(data,0);
len=data.length;
end=gets.indexOf(")",stt);
stt=stt+len+1;
secs=gets.substring(stt,end);
if (secs=="undefined") secs="0";
return secs;
}

// --------------- バイナリ６４進数変換 ---------------------------------
function ftoc()
	{
	var pwd="";
	var i=0;
	var j=0;
	var range="";

	var str="";
	var wval=0;
	var wstr="";

	str=str+tostr(page);
	str=str+tostr(line);
	str=str+tostr(wscrn);
	if (document.FORM2.C_GRP.checked==true) str=str+"1";else str=str+"0";
	if (document.FORM2.C_BGM.checked==true) str=str+"1";else str=str+"0";
	for (i=1;i<=98;i++) if (wflg[i]==0) str=str+'0';else str=str+'1';
	if (flg[99]==0) str=str+'0';else str=str+'1';
	if (flg[100]==0) str=str+'0';else str=str+'1';
	for(i=0;i<=21;i++)
		{
		j=i*6;
		range=str.substring(j,j+6);
		j=parseInt(range,2);
		pwd=pwd+xctbl.charAt(j);
		}
	return pwd;
	}

function ctof(pwd)
	{
	var i=0;
	var j=0;
	var ch="";
	var pos=0;
	var bin="";
	var str="";
	var f1=true;
	var f2=true;

	for(i=0;i<=21;i++)
		{
		ch=pwd.charAt(i);
		pos=xctbl.indexOf(ch,0);
		if (pos==-1) return false;
		if ((pos & 32)!=0) bin='1';else bin='0';
		if ((pos & 16)!=0) bin=bin+'1';else bin=bin+'0';
		if ((pos & 8)!=0) bin=bin+'1';else bin=bin+'0';
		if ((pos & 4)!=0) bin=bin+'1';else bin=bin+'0';
		if ((pos & 2)!=0) bin=bin+'1';else bin=bin+'0';
		if ((pos & 1)!=0) bin=bin+'1';else bin=bin+'0';
		str=str+bin;
		}
	for (i=1;i<=100;i++)
		{
		j=31+i;
		ch=str.charAt(j);
		if (ch=='0') flg[i]=0;else flg[i]=1;
		}
	bin=str.substring( 0,10);page=parseInt(bin,2);
	bin=str.substring(10,20);line=parseInt(bin,2);
	bin=str.substring(20,30);scrn=parseInt(bin,2);
	ch=str.charAt(30);if (ch=='0') f1=false;else f1=true;
	ch=str.charAt(31);if (ch=='0') f2=false;else f2=true;
	document.FORM2.C_GRP.checked=f1;
	document.FORM2.C_BGM.checked=f2;
	return true;
	}
function tostr(pos)
	{
	var s="";
	if ((pos & 512)!=0) s='1';else s='0';
	if ((pos & 256)!=0) s=s+'1';else s=s+'0';
	if ((pos & 128)!=0) s=s+'1';else s=s+'0';
	if ((pos &  64)!=0) s=s+'1';else s=s+'0';
	if ((pos &  32)!=0) s=s+'1';else s=s+'0';
	if ((pos &  16)!=0) s=s+'1';else s=s+'0';
	if ((pos &   8)!=0) s=s+'1';else s=s+'0';
	if ((pos &   4)!=0) s=s+'1';else s=s+'0';
	if ((pos &   2)!=0) s=s+'1';else s=s+'0';
	if ((pos &   1)!=0) s=s+'1';else s=s+'0';
	return s;
	}
