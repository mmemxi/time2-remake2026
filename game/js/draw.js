function init()
	{
	for(i=0;i<=100;i++){flg[i]=0;}
	url_bgm="";line=0;page=0;wscrn=0;scrn=0;
	skipVisualEffect=false;
	clr();clrtxt();
	if(top.MAIN&&typeof top.MAIN.resetScenarioState==="function") top.MAIN.resetScenarioState();
	if(typeof resetMessageHistory==="function") resetMessageHistory();
	}

function draw()
	{
	if ((drawcnt==0)||(gcnt==0))
	  {
	  top.MAIN.setvisual(scrn);
	  top.renderGraphics(drawgrp(),!skipVisualEffect);
	  skipVisualEffect=false;
	  drawcnt=1;
	  }
	if (top.TEXT&&typeof top.TEXT.refreshStoryView==="function")
		top.TEXT.refreshStoryView(top.pendingTextResumeState||null);
	else top.TEXT.window.location.href=top.sys.appUrl("text.html");
	chgbgm();
	if(screenFadePending!==null)
		{
		var fadeMode=screenFadePending;
		screenFadePending=null;
		setTimeout(function(){top.startScreenFade(fadeMode);},0);
		}
	if(endingPending)
		{
		var endingData=endingPending;
		endingPending=null;
		setTimeout(function(){top.startEnding(endingData.number,endingData.title);},0);
		}
	}

function drawgrp()
{
  var layerSlots={jpg:0,gif:0};
  if ((document.FORM2.C_GRP.checked==true)&&(gcnt>0))
    {
  DBUF="<body bgcolor='#000000'><a href='JavaScript:top.sys.change_ch1()'>";
  DBUF=DBUF+"<div style='position:absolute;top:0;left:0'>";
  DBUF=DBUF+"<img src='../resource/original/gif/blank.gif' alt=''></div>";
  for (i=1;i<=gcnt;i++)
      {
      x = lx[i];
      y = ly[i];
      assetFolder = /\.gif$/i.test(lgrp[i]) ? "gif" : "jpg";
      layerSlot=layerSlots[assetFolder]++;
      originalSource = "../resource/original/"+assetFolder+"/"+lgrp[i];
      remakeName = assetFolder=="gif" ? lgrp[i].replace(/\.gif$/i,".png") : lgrp[i];
      remakeSource = "../resource/remake/"+assetFolder+"/"+remakeName;
      if (top.gameMode=="remake")
        {
        source = remakeSource;
        if (assetFolder=="gif")
          {
          htm1 = "<div style='position:absolute;top:0;left:"+(x/4)+"%;height:100%;'>";
          imageStyle = "height:100%;width:auto;max-width:none;object-fit:contain";
          }
        else
          {
          htm1 = "<div style='position:absolute;top:"+(y/3)+"%;left:"+(x/4)+"%;width:"+(lxs[i]/4)+"%;height:"+(lys[i]/3)+"%;'>";
          imageStyle = "width:100%;height:100%;object-fit:cover";
          }
        }
      else
        {
        source=originalSource;
        htm1 = "<div style='position:absolute;top:"+(y/3)+"%;left:"+(x/4)+"%;width:"+(lxs[i]/4)+"%;height:"+(lys[i]/3)+"%;'>";
        imageStyle = "width:100%;height:100%;object-fit:fill";
        }
      htm1=htm1.replace("<div ","<div data-scene-layer='1' data-layer-kind='"+assetFolder+"' data-layer-slot='"+layerSlot+"' ");
      htm2 = "<img src='"+source+"' data-original-source='"+originalSource+"' data-remake-source='"+remakeSource+"' style='"+imageStyle+"' alt=''></div>";
      DBUF=DBUF+htm1+htm2;
      }
    DBUF=DBUF+"</a>";
    return DBUF;
    }
    DBUF="<body bgcolor='#000000'><a href='JavaScript:top.sys.change_ch1()'><img src='../resource/original/gif/blank.gif' width=400 height=300 border=0 alt=''></a>";
    return DBUF;
}

function change_ch1(){
if (document.FORM2.C_GRP.checked==true) document.FORM2.C_GRP.checked=false;
else document.FORM2.C_GRP.checked=true;
top.renderGraphics(drawgrp(),top.imageEffectsEnabled);
}

function change_ck1()
	{
	top.renderGraphics(drawgrp(),top.imageEffectsEnabled);
	}
function skip()
	{
	if (scnt==0) return;
	if (scnt>1) { top.showGameAlert("選択肢から進行先を選んでください。","選択肢があります");return;}
	msgskip=true;
	skipVisualEffect=true;
	if (ls2[1]==0)	top.TEXT.goline(ls[1]);
		else	top.TEXT.gopage(ls2[1],ls[i]);
	}
