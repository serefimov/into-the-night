// SPDX-License-Identifier: GPL-3.0-only
import {geoOrthographic,geoPath} from 'd3-geo';

/** Display geometry only. Match the game's camera; clip and resample on the sphere. */
export function traceCoastline(land,frame,context,pixelRatio=1) {
 const projection=geoOrthographic()
  .rotate([-frame.center.longitudeDeg,-frame.center.latitudeDeg])
  .translate([frame.cx,frame.cy])
  .scale(frame.radius)
  .clipAngle(90)
  .clipExtent([[0,0],[frame.cx*2,frame.cy*2]])
  .precision(.25/pixelRatio);
 geoPath(projection,context)(land);
}
