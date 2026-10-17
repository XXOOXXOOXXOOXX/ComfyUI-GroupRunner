export function centerGroup(canvas,group){
    const rect=group?._bounding||group?.bounding||(group?.pos&&group?.size?[...group.pos,...group.size]:null);
    if(!rect||rect.length<4)throw new Error("无法读取分组位置，请刷新后重试。");
    const [x,y,width,height]=Array.from(rect).slice(0,4);
    if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)throw new Error("分组位置或尺寸无效，请刷新后重试。");
    if(!canvas)throw new Error("画布尚未就绪，请稍后重试。");
    // Native LiteGraph centering handles the current canvas pixel ratio.
    if(typeof canvas.centerOnNode==="function"){
        canvas.centerOnNode({pos:[x,y],size:[width,height]});return;
    }
    // Compatibility with frontends exposing only the viewport transform.
    const ds=canvas.ds,element=canvas.canvas,box=element?.getBoundingClientRect?.();
    const dpr=canvas.dpr||globalThis.devicePixelRatio||1;
    const viewport=ds?.getViewportSize?.()||[box?.width||element?.clientWidth||element?.width/dpr,box?.height||element?.clientHeight||element?.height/dpr];
    if(!ds?.offset||!Number.isFinite(ds.scale)||ds.scale<=0||!viewport.every(value=>Number.isFinite(value)&&value>0))throw new Error("画布尚未就绪，请稍后重试。");
    ds.offset[0]=viewport[0]/(2*ds.scale)-x-width/2;
    ds.offset[1]=viewport[1]/(2*ds.scale)-y-height/2;
    canvas.setDirty?.(true,true);
}
