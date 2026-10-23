#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Pinned OurAirports subset. Python stdlib only; no execution from downloaded data."""
import argparse, base64, csv, gzip, hashlib, io, json, pathlib, urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]

def generate(selection, downloads):
    wanted=set(selection['idents'])
    if len(wanted)!=len(selection['idents']):raise ValueError('Duplicate selection identifier')
    airports=list(csv.DictReader(io.StringIO(downloads['airports.csv'].decode('utf-8-sig'))))
    runways=list(csv.DictReader(io.StringIO(downloads['runways.csv'].decode('utf-8-sig'))))
    if selection.get('includeLargeAirports',False):wanted.update(r['ident'] for r in airports if r['type']=='large_airport')
    chosen={r['ident']:r for r in airports if r['ident'] in wanted}
    if set(chosen)!=wanted:raise ValueError('Missing airports: '+str(sorted(wanted-set(chosen))))
    result=[]
    for ident in sorted(wanted):
        row=chosen[ident]
        if row['type'] not in ['large_airport','medium_airport']:raise ValueError('Unexpected airport type: '+ident)
        candidates=[]
        for r in runways:
            if r['airport_ident']!=ident or r['closed']!='0':continue
            if not r['length_ft'] or not r['width_ft']:continue
            candidates.append({'sourceRowId':int(r['id']),'ends':[r['le_ident'],r['he_ident']], 'lengthM':round(float(r['length_ft'])*0.3048,3),'widthM':round(float(r['width_ft'])*0.3048,3),'surface':r['surface'],'lighted':r['lighted']=='1'})
        candidates.sort(key=lambda r:(-r['lengthM'],r['sourceRowId']))
        best=candidates[:3]
        screen=any(r['lengthM']>=3000 and r['widthM']>=45 and any(s in r['surface'].upper() for s in ['ASP','CON','BIT','PEM']) for r in best)
        result.append({'id':ident,'ourAirportsId':int(row['id']),'iata':row['iata_code'] or None,'icao':row.get('icao_code') or row.get('gps_code') or None,'name':row['name'],'country':row['iso_country'],'continent':row['continent'] or 'NA','latitudeDeg':float(row['latitude_deg']),'longitudeDeg':float(row['longitude_deg']),'elevationFt':float(row['elevation_ft']) if row['elevation_ft'] else None,'sourceId':'ourairports','runways':best,'suitability':{'status':'screened-candidate' if screen else 'unverified','rule':'paved-open-3000m-by-45m-v1','operationalApproval':False}})
    hashes={name:hashlib.sha256(value).hexdigest() for name,value in downloads.items()}
    return {'catalogVersion':selection.get('catalogVersion',1),'retrievedDate':selection['retrievedDate'],'source':{'id':'ourairports','repository':'davidmegginson/ourairports-data','commit':selection['sourceCommit'],'license':'Public Domain','termsUrl':'https://ourairports.com/data/','dictionaryUrl':'https://ourairports.com/help/data-dictionary.html','fileSha256':hashes},'airports':result}

def main():
    p=argparse.ArgumentParser();p.add_argument('--selection',type=pathlib.Path,default=ROOT/'data/mission/selection.json');p.add_argument('--source-dir',type=pathlib.Path);p.add_argument('--output',type=pathlib.Path,default=ROOT/'.build/mission-import/airports.json');p.add_argument('--log-archive',action='store_true');args=p.parse_args()
    selection=json.loads(args.selection.read_text())
    downloads={}
    for name in ['airports.csv','runways.csv']:
        if args.source_dir:downloads[name]=(args.source_dir/name).read_bytes()
        else:
            url='https://raw.githubusercontent.com/davidmegginson/ourairports-data/'+selection['sourceCommit']+'/'+name
            with urllib.request.urlopen(url,timeout=60) as response:downloads[name]=response.read()
    result=generate(selection,downloads);args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('Imported',len(result['airports']),'airports from',selection['sourceCommit'])
    # Public domain data only: allows connector-only retrieval when local outbound sockets are unavailable.
    if args.log_archive:print('MISSION_DATA '+base64.b64encode(gzip.compress(args.output.read_bytes(),mtime=0)).decode())
if __name__=='__main__':main()
