"""Audit the research-only candidate; never import it into the active scene."""
import json,hashlib
from pathlib import Path
import pyarrow.parquet as pq
import numpy as np
from shapely import from_wkb
p=Path('data/research/Vedas_Gandhinagar_Buildings.parquet');t=pq.read_table(p)
g=from_wkb(t['geometry'].to_pylist());heights=np.array(t['Height'].to_pylist());bounds=np.array([x.bounds for x in g])
r={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'rows':len(g),'columns':t.column_names,'geoMetadata':json.loads(t.schema.metadata.get(b'geo',b'{}')),'invalid':sum(not x.is_valid for x in g),'empty':sum(x.is_empty for x in g),'geometryTypes':sorted(set(x.geom_type for x in g)),'bounds':[bounds[:,0].min(),bounds[:,1].min(),bounds[:,2].max(),bounds[:,3].max()],'rawHeight':{'min':int(heights.min()),'max':int(heights.max()),'median':float(np.median(heights)),'p95':float(np.percentile(heights,95)),'positive':int(sum(heights>0))},'heightUnits':'Not established by this file; not used as metres. Raw values retained in original file.','decision':'Research only; active pipeline uses OSM ODbL. Community CC0 cannot establish clearance of upstream government rights.','methodology':'Official VEDAS describes Cartosat LoD1, representative 2018–2020; not a textured or surveyed model.','sources':['https://vedas.sac.gov.in/vapps/3d/3d_city/index.html','https://github.com/ramSeraph/indianopenmaps/blob/main/DATA_LICENSE.md']}
Path('outputs/candidate-audit.json').write_text(json.dumps(r,indent=2));print(json.dumps({k:v for k,v in r.items() if k!='geoMetadata'},indent=2))
