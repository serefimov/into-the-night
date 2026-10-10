import { greatCircle, greatCirclePosition } from './geometry.js';
import type { Coordinates } from './solar.js';
/** Sample the kernel's orthodromy, then split drawing at the map seam.
 * Projection is for display only; it never participates in safety. */
export function mapRoute(from: Coordinates, to: Coordinates): Coordinates[][] {
  const path=greatCircle(from,to),count=2*Math.max(4,Math.ceil(path.angleRad*180/Math.PI/2));
  const lines: Coordinates[][]=[[]];
  let previous: Coordinates | null=null;
  for(let i=0;i<=count;i++) {
    const point=greatCirclePosition(path,i/count);
    if(previous && Math.abs(point.longitudeDeg-previous.longitudeDeg)>180) {
      const shifted=point.longitudeDeg+(point.longitudeDeg<previous.longitudeDeg?360:-360);
      const seam=previous.longitudeDeg>0?180:-180;
      const fraction=(seam-previous.longitudeDeg)/(shifted-previous.longitudeDeg);
      const latitudeDeg=previous.latitudeDeg+(point.latitudeDeg-previous.latitudeDeg)*fraction;
      lines[lines.length-1]!.push({latitudeDeg,longitudeDeg:seam});
      lines.push([{latitudeDeg,longitudeDeg:-seam}]);
    }
    lines[lines.length-1]!.push(point);previous=point;
  }
  return lines;
}
