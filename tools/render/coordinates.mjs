import proj4 from 'proj4';
export const UTM = '+proj=utm +zone=43 +datum=WGS84 +units=m +no_defs';
export function project(lon, lat, origin) {
  const [east, north] = proj4('EPSG:4326', UTM, [lon, lat]);
  return [east-origin.easting, north-origin.northing];
}
export function cameraTransform(bounds, config) {
  const a = config.camera.azimuth*Math.PI/180, e = config.camera.elevation*Math.PI/180;
  const right=[Math.cos(a), Math.sin(a), 0];
  const up=[-Math.sin(a)*Math.sin(e), Math.cos(a)*Math.sin(e), Math.cos(e)];
  const eye=[Math.sin(a)*Math.cos(e),-Math.cos(a)*Math.cos(e),Math.sin(e)];
  const [xmin,ymin,xmax,ymax] = bounds;
  const corners=[[xmin,ymin,0],[xmax,ymin,0],[xmax,ymax,0],[xmin,ymax,0]];
  const us=corners.map(p=>dot(p,right)), vs=corners.map(p=>dot(p,up));
  const margin=config.camera.margin;
  const scale=Math.min(config.width/(Math.max(...us)-Math.min(...us)+2*margin),config.height/(Math.max(...vs)-Math.min(...vs)+2*margin));
  const midU=(Math.min(...us)+Math.max(...us))/2, midV=(Math.min(...vs)+Math.max(...vs))/2;
  return {right,up,eye,scale,minU:midU-config.width/scale/2,maxV:midV+config.height/scale/2,width:config.width,height:config.height,pixelOrigin:'top-left; continuous image-edge coordinates',groundZ:0,crs:'EPSG:32643',azimuth:config.camera.azimuth,elevation:config.camera.elevation};
}
export function dot(p,b){return p.reduce((s,v,i)=>s+v*b[i],0);}
export function worldToImage(p,t){return [(dot(p,t.right)-t.minU)*t.scale,(t.maxV-dot(p,t.up))*t.scale];}
export function imageToGround(p,t,z=0){
  const u=p[0]/t.scale+t.minU-t.right[2]*z, v=t.maxV-p[1]/t.scale-t.up[2]*z;
  const det=t.right[0]*t.up[1]-t.right[1]*t.up[0];
  return [(u*t.up[1]-v*t.right[1])/det,(v*t.right[0]-u*t.up[0])/det,z];
}
