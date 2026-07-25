#!/usr/bin/env python3
# build-land.py — Vetric off-market land engine (Option A, 2026-07-25)
#
# Finds VACANT, COMMERCIALLY-PLAUSIBLE parcels across the 9-county DFW metroplex and emits
# dfw-land.json for the "Off-market land" map layer. These are NOT listings — they are owner-of-
# record parcels from public county appraisal rolls (the off-market call list; land-bank thesis).
#
# Sources (all free, public record):
#   Direct CAD ArcGIS query services (fresh, class-coded):
#     Collin  — CCAD mirror (Allen)   state_cd C3-C6  = vacant commercial (commercial_fl='T' verified)
#     Denton  — gis.dentoncounty.gov  STATE_CD 'C2'   = vacant commercial (US-377/I-35 frontage verified)
#     Dallas  — DallasTaxParcels      SPTBCODE C% AND PROP_CL ~ 'COMM' (descriptions authoritative;
#                                     subcodes conflict across the CADs mixed into that service)
#     Tarrant — TADParcels            no class field → IMPR_VALUE=0 ∧ LAND_VALUE>5k, corridor-classified
#   TxGIO StratMap 2025 land-parcel GDBs (fiona) for the outer five:
#     Rockwall, Kaufman, Ellis, Johnson, Parker — their CADs assign state class only to IMPROVED
#     parcels in the StratMap export (verified: code-less ≈ imp=0), so vacancy = values rule,
#     commercial plausibility = retail-corridor proximity (dfw-retail.json).
#
# Filters: 0.5–150 acres; public/exempt/church/HOA owners dropped; value-based rows must sit
# within 500 m of a mapped retail/commercial point ('cor') or be ≥3 ac within 1500 m ('hwy').
# Class-coded rows ship regardless (cls 'cad'). Drop counts are logged — no silent caps.
#
# Run:  python3 build-land.py          (needs: pip install --user fiona ; ~5-15 min cold)
# Then: bump the ?v= on the dfw-land.json fetch in index.html.
# Cache: .land-cache/ (git-ignored) holds the StratMap zips — reruns skip finished downloads.

import json, math, os, re, sys, time, urllib.request, urllib.parse, zipfile, glob

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '.land-cache')
os.makedirs(CACHE, exist_ok=True)
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 VetricLandBuild/1.0 (contact: jondduhon@gmail.com)'
OUT = os.path.join(HERE, 'dfw-land.json')

AC_MIN, AC_MAX = 0.5, 150.0
COR_M, HWY_M, HWY_AC = 500, 1500, 3.0
STRAT = 'https://data.geographic.texas.gov/0fa04328-872e-481c-b453-126a74777593/resources/stratmap25-landparcels_{fips}_lp.zip'
OUTER = [('Rockwall','48397'), ('Kaufman','48257'), ('Ellis','48139'), ('Johnson','48251'), ('Parker','48367')]

JUNK_OWNER = re.compile(
    r'\b(CITY OF|COUNTY OF|STATE OF|UNITED STATES|U S A|USA INC|ISD\b|SCHOOL DIST|TXDOT|'
    r'TEXAS DEPT|TEXAS DEPARTMENT|TEXAS TRANSPORT|CHURCH|IGLESIA|MOSQUE|MINISTRIES|MINISTRY|'
    r'BAPTIST|METHODIST|CATHOLIC|LUTHERAN|PRESBYTERIAN|ASSEMBLY OF GOD|HOMEOWNERS|\bHOA\b|'
    r'OWNERS ASSOC|OWNERS ASSN|PROPERTY OWNERS|RESIDENTIAL ASSOC|COMMUNITY ASSOC|MUNICIPAL|'
    r'UTILITY DIST|\bMUD\b|FRESH WATER|WATER SUPPLY|\bWSC\b|AUTHORITY|CEMETERY|MASONIC|'
    r'AMERICAN LEGION|HABITAT FOR|LEVEE DIST|DRAINAGE DIST|IMPROVEMENT DIST|EMERGENCY SERVICE)', re.I)

def fetch(url, tries=3, timeout=60):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': 'https://data.geographic.texas.gov/'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e; time.sleep(1.5 * (i + 1))
    raise last

def arcgis_pages(base, where, fields, page):
    """Yield feature dicts (geojson) from a paged ArcGIS query. Never raises past a page retry."""
    off = 0
    while True:
        q = urllib.parse.urlencode({
            'where': where, 'outFields': fields, 'returnGeometry': 'true',
            'maxAllowableOffset': '0.0005', 'outSR': '4326', 'f': 'geojson',
            'resultOffset': off, 'resultRecordCount': page})
        d = json.loads(fetch(base + '/query?' + q, timeout=90))
        feats = d.get('features') or []
        if not feats: return
        for f in feats: yield f
        if len(feats) < page: return
        off += page
        time.sleep(0.15)

def _rings(geom):
    if not geom: return []
    t, c = geom.get('type'), geom.get('coordinates')
    if t == 'Polygon': return [c[0]] if c else []
    if t == 'MultiPolygon': return [p[0] for p in c if p]
    return []

def centroid(geom):
    """Mean of the largest outer ring — good enough for a pin."""
    rings = _rings(geom)
    if not rings: return None
    ring = max(rings, key=len)
    n = len(ring)
    if not n: return None
    lo = sum(p[0] for p in ring) / n
    la = sum(p[1] for p in ring) / n
    return (round(la, 5), round(lo, 5))

def geom_acres(geom):
    """Shoelace over the outer rings of an EPSG:4326 polygon → acres."""
    tot = 0.0
    for ring in _rings(geom):
        if len(ring) < 3: continue
        la0 = sum(p[1] for p in ring) / len(ring)
        kx = 111320.0 * math.cos(math.radians(la0)); ky = 110540.0
        s = 0.0
        for i in range(len(ring) - 1):
            x1, y1 = ring[i][0] * kx, ring[i][1] * ky
            x2, y2 = ring[i + 1][0] * kx, ring[i + 1][1] * ky
            s += x1 * y2 - x2 * y1
        tot += abs(s) / 2.0
    return tot / 4046.86

# --- retail-corridor index (dfw-retail.json: plain [[lat,lon],...]) ---------------------------
_ret_bins = {}
def load_corridors():
    pts = json.load(open(os.path.join(HERE, 'dfw-retail.json')))
    for la, lo in pts:
        _ret_bins.setdefault((int(la * 100), int(lo * 100)), []).append((la, lo))
    print(f'corridor index: {len(pts)} retail points')

def corridor_m(la, lo):
    best = 1e12
    bi, bj = int(la * 100), int(lo * 100)
    for i in range(bi - 2, bi + 3):
        for j in range(bj - 2, bj + 3):
            for (pa, po) in _ret_bins.get((i, j), ()):
                dx = (po - lo) * 111320 * math.cos(math.radians(la))
                dy = (pa - la) * 110540
                d2 = dx * dx + dy * dy
                if d2 < best: best = d2
    return math.sqrt(best)

def keep_row(own, ac):
    if not own or JUNK_OWNER.search(own): return False
    if ac < AC_MIN or ac > AC_MAX: return False
    return True

def classify_value_row(la, lo, ac):
    """Value-based vacancy needs a commercial signal. Returns cls or None (drop)."""
    d = corridor_m(la, lo)
    if d <= COR_M: return 'cor'
    if ac >= HWY_AC and d <= HWY_M: return 'hwy'
    return None

rows, stats = [], {}

def add(county, cls, la, lo, ac, own, mail, situs, city, val, pid):
    rows.append({'la': la, 'lo': lo, 'ac': round(ac, 2), 'own': own[:80], 'ml': (mail or '')[:110],
                 'st': (situs or '')[:70], 'ct': (city or '')[:30], 'co': county, 'cls': cls,
                 'lv': int(val) if val else None, 'pid': str(pid or '')})

def tally(county, key, n=1):
    stats.setdefault(county, {}).setdefault(key, 0)
    stats[county][key] += n

# --- direct CAD pulls -------------------------------------------------------------------------
def pull_denton():
    base = 'https://gis.dentoncounty.gov/arcgis/rest/services/Parcels/MapServer/0'
    F = 'OWNER_NAME,ADDR_LINE1,ADDR_LINE2,ADDR_LINE3,ZIP,LAND_SQFT,SITUS,CITY,prop_id'
    for f in arcgis_pages(base, "STATE_CD='C2'", F, 1000):
        a = f.get('properties') or {}; tally('Denton', 'raw')
        c = centroid(f.get('geometry'))
        if not c: tally('Denton', 'no-geom'); continue
        ac = (a.get('LAND_SQFT') or 0) / 43560.0
        own = (a.get('OWNER_NAME') or '').strip()
        if not keep_row(own, ac): tally('Denton', 'filtered'); continue
        mail = ', '.join(str(x).strip() for x in [a.get('ADDR_LINE1'), a.get('ADDR_LINE2'), a.get('ADDR_LINE3'), a.get('ZIP')] if x and str(x).strip())
        add('Denton', 'cad', c[0], c[1], ac, own, mail, a.get('SITUS'), a.get('CITY'), None, a.get('prop_id'))
        tally('Denton', 'kept')

def pull_collin():
    base = 'https://gismaps.cityofallen.org/arcgis/rest/services/ReferenceData/Collin_County_Appraisal_District_Parcels/MapServer/1'
    P = 'GIS_DBO_AD_Entity_'
    F = ','.join(P + x for x in ['file_as_name', 'addr_line1', 'addr_city', 'addr_state', 'addr_zip',
                                 'legal_acreage', 'land_sqft', 'situs_display', 'situs_city',
                                 'curr_land_non', 'prop_id'])
    for f in arcgis_pages(base, P + "state_cd IN ('C3','C4','C5','C6')", F, 2000):
        a = f.get('properties') or {}; tally('Collin', 'raw')
        c = centroid(f.get('geometry'))
        if not c: tally('Collin', 'no-geom'); continue
        ac = a.get(P + 'legal_acreage') or ((a.get(P + 'land_sqft') or 0) / 43560.0)
        own = (a.get(P + 'file_as_name') or '').strip()
        if not keep_row(own, ac or 0): tally('Collin', 'filtered'); continue
        mail = ', '.join(str(x).strip() for x in [a.get(P + 'addr_line1'), a.get(P + 'addr_city'), a.get(P + 'addr_state'), a.get(P + 'addr_zip')] if x and str(x).strip())
        add('Collin', 'cad', c[0], c[1], ac, own, mail, a.get(P + 'situs_display'), a.get(P + 'situs_city'), a.get(P + 'curr_land_non'), a.get(P + 'prop_id'))
        tally('Collin', 'kept')

def pull_dallas():
    base = 'https://gis.dallascityhall.com/arcgis/rest/services/Basemap/DallasTaxParcels/FeatureServer/0'
    F = 'TAXPANAME1,TAXPAADD1,TAXPACITY,TAXPASTA,TAXPAZIP,AREA_FEET,ST_NUM,ST_DIR,ST_NAME,ST_TYPE,CITY,ACCT'
    W = "SPTBCODE LIKE 'C%' AND UPPER(PROP_CL) LIKE '%COMM%' AND AREA_FEET>=21780"
    for f in arcgis_pages(base, W, F, 2000):
        a = f.get('properties') or {}; tally('Dallas', 'raw')
        c = centroid(f.get('geometry'))
        if not c: tally('Dallas', 'no-geom'); continue
        ac = (a.get('AREA_FEET') or 0) / 43560.0
        own = (a.get('TAXPANAME1') or '').strip()
        if not keep_row(own, ac): tally('Dallas', 'filtered'); continue
        mail = ', '.join(str(x).strip() for x in [a.get('TAXPAADD1'), a.get('TAXPACITY'), a.get('TAXPASTA'), a.get('TAXPAZIP')] if x and str(x).strip())
        situs = ' '.join(str(x).strip() for x in [a.get('ST_NUM'), a.get('ST_DIR'), a.get('ST_NAME'), a.get('ST_TYPE')] if x and str(x).strip())
        add('Dallas', 'cad', c[0], c[1], ac, own, mail, situs, a.get('CITY'), None, a.get('ACCT'))
        tally('Dallas', 'kept')

def pull_tarrant():
    base = 'https://mapit.tarrantcounty.com/arcgis/rest/services/Dynamic/TADParcels/FeatureServer/0'
    F = 'OWNER_NAME,OWNER_ADDR,OWNER_CITY,OWNER_ZIP,SITUS_ADDR,CITY,LAND_ACRES,LAND_VALUE,ACCOUNT'
    W = 'IMPR_VALUE=0 AND LAND_VALUE>5000 AND LAND_ACRES>=0.5 AND LAND_ACRES<=150'
    for f in arcgis_pages(base, W, F, 4000):
        a = f.get('properties') or {}; tally('Tarrant', 'raw')
        c = centroid(f.get('geometry'))
        if not c: tally('Tarrant', 'no-geom'); continue
        ac = a.get('LAND_ACRES') or 0
        own = (a.get('OWNER_NAME') or '').strip()
        if not keep_row(own, ac): tally('Tarrant', 'filtered'); continue
        cls = classify_value_row(c[0], c[1], ac)
        if not cls: tally('Tarrant', 'no-corridor'); continue
        mail = ', '.join(str(x).strip() for x in [a.get('OWNER_ADDR'), a.get('OWNER_CITY'), a.get('OWNER_ZIP')] if x and str(x).strip())
        add('Tarrant', cls, c[0], c[1], ac, own, mail, a.get('SITUS_ADDR'), a.get('CITY'), a.get('LAND_VALUE'), a.get('ACCOUNT'))
        tally('Tarrant', 'kept')

# --- StratMap outer five ----------------------------------------------------------------------
def strat_county(county, fips):
    import fiona
    zp = os.path.join(CACHE, f'{fips}.zip')
    if not os.path.exists(zp) or os.path.getsize(zp) < 100000:
        print(f'  downloading StratMap {county}…')
        open(zp, 'wb').write(fetch(STRAT.format(fips=fips), timeout=600))
    ex = os.path.join(CACHE, fips)
    if not glob.glob(ex + '/fgdb/*.gdb'):
        zipfile.ZipFile(zp).extractall(ex)
    gdb = glob.glob(ex + '/fgdb/*.gdb')[0]
    with fiona.open(gdb) as src:
        for f in src:
            a = f['properties']; tally(county, 'raw')
            if (a['IMP_VALUE'] or 0) > 0 or (a['LAND_VALUE'] or 0) <= 5000: tally(county, 'not-vacant'); continue
            g = f['geometry']
            gj = {'type': g['type'], 'coordinates': g['coordinates']} if g else None
            # GIS_AREA ships in square DEGREES despite its unit field claiming 'Acres' (StratMap
            # export artifact — verified: 18.458-ac parcel carries GIS_AREA 1.79e-05). Use the
            # CAD's LEGAL_AREA; recompute from geometry when it's missing.
            ac = a['LEGAL_AREA'] if (a['LEGAL_AREA'] and str(a['LGL_AREA_U'] or '').upper().startswith('ACRE')) else 0
            if not ac or ac <= 0: ac = geom_acres(gj)
            own = (a['OWNER_NAME'] or '').strip()
            if not keep_row(own, ac or 0): tally(county, 'filtered'); continue
            c = centroid(gj)
            if not c: tally(county, 'no-geom'); continue
            cls = classify_value_row(c[0], c[1], ac)
            if not cls: tally(county, 'no-corridor'); continue
            add(county, cls, c[0], c[1], ac, own, a['MAIL_ADDR'], a['SITUS_ADDR'], a['SITUS_CITY'], a['LAND_VALUE'], a['Prop_ID'])
            tally(county, 'kept')

def main():
    t0 = time.time()
    load_corridors()
    for name, fn in [('Collin', pull_collin), ('Denton', pull_denton), ('Dallas', pull_dallas), ('Tarrant', pull_tarrant)]:
        try:
            print(f'{name}: querying CAD service…'); fn()
        except Exception as e:
            print(f'  !! {name} failed, county skipped: {e}')
    for county, fips in OUTER:
        try:
            print(f'{county}: StratMap…'); strat_county(county, fips)
        except Exception as e:
            print(f'  !! {county} failed, county skipped: {e}')
    # de-dup by county+pid (paging overlap safety)
    seen, out = set(), []
    for r in rows:
        k = (r['co'], r['pid'])
        if k in seen: continue
        seen.add(k); out.append(r)
    doc = {'v': 1, 'built': time.strftime('%Y-%m-%d'), 'n': len(out),
           'credit': 'County appraisal districts (public record) + TxGIO StratMap Land Parcels 2025. Owner of record — not listings.',
           'list': out}
    tmp = OUT + '.tmp'
    json.dump(doc, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, OUT)
    print(f'\nwrote {OUT}: {len(out)} parcels ({os.path.getsize(OUT)//1024} KB) in {int(time.time()-t0)}s')
    for c, s in stats.items(): print(f'  {c}: {s}')

if __name__ == '__main__':
    main()
