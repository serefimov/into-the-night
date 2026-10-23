#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
import csv, importlib.util, io, pathlib, unittest
spec=importlib.util.spec_from_file_location('mission_import',pathlib.Path(__file__).with_name('import-mission-airports.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def table(rows):
 s=io.StringIO();w=csv.DictWriter(s,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows);return s.getvalue().encode()
class ImportTests(unittest.TestCase):
 def test_open_runways_and_ft_to_m(self):
  airport={'id':'1','ident':'TEST','iata_code':'TST','gps_code':'TEST','name':'Test, Airport','type':'medium_airport','iso_country':'US','continent':'NA','latitude_deg':'40','longitude_deg':'-70','elevation_ft':'30'}
  runway={'id':'2','airport_ident':'TEST','closed':'0','length_ft':'10000','width_ft':'150','surface':'ASP','lighted':'1','le_ident':'01','he_ident':'19'}
  closed={**runway,'id':'3','closed':'1','length_ft':'20000'}
  result=module.generate({'idents':['TEST'],'retrievedDate':'2026-10-23','sourceCommit':'a'*40},{'airports.csv':table([airport]),'runways.csv':table([runway,closed])});a=result['airports'][0]
  self.assertEqual(a['name'],'Test, Airport');self.assertEqual(len(a['runways']),1);self.assertEqual(a['runways'][0]['lengthM'],3048);self.assertEqual(a['runways'][0]['widthM'],45.72);self.assertFalse(a['suitability']['operationalApproval']);self.assertEqual(a['suitability']['status'],'screened-candidate')
  runway['width_ft']='';result=module.generate({'idents':['TEST'],'retrievedDate':'2026-10-23','sourceCommit':'a'*40},{'airports.csv':table([airport]),'runways.csv':table([runway])});self.assertEqual(result['airports'][0]['suitability']['status'],'unverified')
 def test_duplicate_selection_rejected(self):
  with self.assertRaises(ValueError):module.generate({'idents':['TEST','TEST']},{})
if __name__=='__main__':unittest.main()
