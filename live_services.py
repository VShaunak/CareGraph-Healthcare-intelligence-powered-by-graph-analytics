"""Fresh, on-demand public-source lookups used by Hospital Overload Phase 5."""
from __future__ import annotations
import json, math, re, time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

USER_AGENT="HospitalOverloadPhase5/1.0 local research prototype"
NOMINATIM="https://nominatim.openstreetmap.org/search"; OVERPASS="https://overpass-api.de/api/interpreter"; OSRM="https://router.project-osrm.org/route/v1/driving"
CMS="https://data.cms.gov/provider-data/api/1/datastore/query"; NPPES="https://npiregistry.cms.hhs.gov/api/"
class LiveSourceError(RuntimeError): pass
STATE_CODES={"New Jersey":"NJ","New York":"NY","Pennsylvania":"PA","Connecticut":"CT","Delaware":"DE"}

def state_code(value):
    return STATE_CODES.get((value or "").strip(),(value or "").strip().upper())

def get_json(url, params=None, timeout=22):
    if params: url += "?" + urlencode(params, doseq=True)
    try:
        with urlopen(Request(url,headers={"User-Agent":USER_AGENT,"Accept":"application/json"}),timeout=timeout) as response: return json.loads(response.read().decode("utf-8"))
    except (HTTPError,URLError,TimeoutError,json.JSONDecodeError) as exc: raise LiveSourceError("A live public source did not return usable information. Please try again.") from exc

def miles_between(a,b,c,d):
    p1,p2,dx,dy=map(math.radians,[a,c,c-a,d-b]); return 3958.8*2*math.asin(math.sqrt(math.sin(dx/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dy/2)**2))

def locate_zip(zip_code):
    if not re.fullmatch(r"\d{5}",(zip_code or "").strip()): raise ValueError("Enter a valid 5-digit U.S. ZIP code.")
    items=get_json(NOMINATIM,{"postalcode":zip_code,"country":"United States","format":"jsonv2","addressdetails":1,"limit":1})
    if not items: raise ValueError("The live location source did not find that ZIP code.")
    item=items[0]; address=item.get("address",{}); city=address.get("city") or address.get("town") or address.get("village") or ""
    return {"zip":zip_code,"lat":float(item["lat"]),"lon":float(item["lon"]),"label":item.get("display_name",zip_code),"city":city,"state":state_code(address.get("state",""))}

def nearby_facilities(location,radius=35000,hospital_limit=12,urgent_limit=12):
    """Fresh bounded search of OSM's live geocoding index; no local facility list."""
    radius_miles=radius/1609
    # Search a fixed maximum area, then filter results by the selected radius.
    # This prevents the source's capped/ranked responses from making a 200-mile
    # search return fewer choices than a smaller-radius search.
    source_radius_miles=200
    lat_delta=source_radius_miles/69.0
    lon_delta=source_radius_miles/(69.0*max(math.cos(math.radians(location["lat"])),.15))
    viewbox=f"{location['lon']-lon_delta},{location['lat']+lat_delta},{location['lon']+lon_delta},{location['lat']-lat_delta}"
    buckets,seen={"hospital":[],"urgent_care":[]},set()
    for index,(kind,query,limit) in enumerate((("hospital","hospital",hospital_limit),("urgent_care","urgent care",urgent_limit))):
        if index: time.sleep(1.05)  # Respect the public Nominatim one-request-per-second policy.
        payload=get_json(NOMINATIM,{"q":query,"format":"jsonv2","limit":min(limit,40),"addressdetails":1,"viewbox":viewbox,"bounded":1})
        for item in payload:
            name=item.get("name") or item.get("display_name","").split(",")[0]; lat=float(item["lat"]); lon=float(item["lon"])
            distance=miles_between(location['lat'],location['lon'],lat,lon); key=(name.casefold(),round(lat,3),round(lon,3))
            if not name or key in seen or distance>radius_miles: continue
            seen.add(key); address=item.get("address",{}); city=address.get("city") or address.get("town") or address.get("village") or ""; state=address.get("state","")
            buckets[kind].append({"name":name,"kind":kind,"lat":lat,"lon":lon,"address":item.get("display_name","").replace(name+", ","",1),"phone":"","city":city,"state":state,"osm_url":f"https://www.openstreetmap.org/{item.get('osm_type')}/{item.get('osm_id')}","straight_miles":round(distance,1)})
    for key in buckets: buckets[key].sort(key=lambda x:x["straight_miles"])
    return buckets["hospital"][:hospital_limit]+buckets["urgent_care"][:urgent_limit]

def nppes_zip_facilities(location, hospital_limit=6, urgent_limit=6):
    """Reliable official fallback: current CMS NPPES organizations registered in the searched ZIP."""
    # CMS Care Compare is the primary official hospital directory. NPPES is
    # used for urgent care because Care Compare only covers Medicare hospitals.
    buckets={"hospital":[],"urgent_care":[]}
    for item in cms_query("xubh-q36u",[("zip_code",location["zip"],"starts with")],50):
        buckets["hospital"].append({"name":item.get("facility_name","").title(),"kind":"hospital","address":", ".join(filter(None,[item.get("address"),item.get("citytown"),item.get("state")])),"city":item.get("citytown","").title(),"state":item.get("state","").upper(),"phone":item.get("telephone_number","") or "","npi":""})
    payload=get_json(NPPES,{"version":"2.1","city":location.get("city","") or location["zip"],"state":location.get("state","") or "NJ","enumeration_type":"NPI-2","limit":200})
    for item in payload.get("results",[]):
        basic=item.get("basic",{}); name=basic.get("organization_name"); address=next((a for a in item.get("addresses",[]) if a.get("address_purpose")=="LOCATION"),None); taxonomies=[t.get("desc") or "" for t in item.get("taxonomies",[])]
        if not name or not address or not any("Urgent Care" in taxonomy for taxonomy in taxonomies): continue
        buckets["urgent_care"].append({"name":name.title(),"kind":"urgent_care","address":", ".join(filter(None,[address.get("address_1"),address.get("address_2"),address.get("city"),address.get("state")])),"city":address.get("city","").title(),"state":address.get("state","").upper(),"phone":address.get("telephone_number","") or basic.get("authorized_official_telephone_number","") or "","npi":item.get("number","")})
    selected=buckets["hospital"][:hospital_limit]+buckets["urgent_care"][:urgent_limit]
    geocoded=[]
    for facility in selected:
        # Nominatim's public-service policy allows one request per second. This
        # deliberate pause prevents this fallback from turning into bulk geocoding.
        time.sleep(1.05)
        try:
            result=get_json(NOMINATIM,{"q":facility["name"]+", "+facility["address"]+", United States","format":"jsonv2","limit":1,"addressdetails":1})
        except LiveSourceError: continue
        if not result:
            time.sleep(1.05)
            street_address=re.sub(r"\s+(STE|SUITE|UNIT|#)\s*[^,]+", "", facility["address"], flags=re.I)
            try: result=get_json(NOMINATIM,{"q":street_address+", United States","format":"jsonv2","limit":1,"addressdetails":1})
            except LiveSourceError: continue
        if not result:
            time.sleep(1.05)
            try: result=get_json(NOMINATIM,{"q":facility["name"]+", "+facility["city"]+", "+facility["state"],"format":"jsonv2","limit":1,"addressdetails":1})
            except LiveSourceError: continue
        if not result: continue
        point=result[0]; lat,lon=float(point["lat"]),float(point["lon"])
        source_url=f"https://www.medicare.gov/care-compare/?providerType=Hospital&keyword={facility['name']}" if facility["kind"]=="hospital" else f"https://npiregistry.cms.hhs.gov/provider-view/{facility['npi']}"
        geocoded.append({**facility,"lat":lat,"lon":lon,"osm_url":source_url,"straight_miles":round(miles_between(location["lat"],location["lon"],lat,lon),1)})
    return geocoded

def route(location,facility):
    data=get_json(f"{OSRM}/{location['lon']},{location['lat']};{facility['lon']},{facility['lat']}",{"overview":"false"})
    if not data.get("routes"): raise LiveSourceError("The live road-routing source did not return a route.")
    item=data["routes"][0]; return {"road_miles":round(item["distance"]/1609.344,1),"drive_minutes":max(1,round(item["duration"]/60))}

def travel(route_data,mode):
    if mode=="drive": return {"label":"Drive","minutes":route_data["drive_minutes"],"basis":"live road-route estimate"}
    mph,label=(3,"Walk") if mode=="walk" else (10,"Cycle"); return {"label":label,"minutes":max(1,round(route_data["road_miles"]/mph*60)),"basis":f"estimate from live road distance at {mph} mph"}

def requested_radius(value):
    try: radius=int(value)
    except (TypeError,ValueError): radius=15
    if not 15 <= radius <= 200: raise ValueError("Choose a search radius from 15 to 200 miles.")
    return radius

def discover(zip_code,mode="drive",radius_miles=15,scope="local"):
    location=locate_zip(zip_code)
    radius_miles=requested_radius(radius_miles)
    # Fresh geographic discovery returns both hospitals and urgent care within
    # the user-selected radius. CMS/NPPES is a live official fallback only if
    # the map service is temporarily unavailable.
    try:
        facilities=nearby_facilities(location,radius=radius_miles*1609,hospital_limit=40,urgent_limit=40)
    except LiveSourceError:
        facilities=nppes_zip_facilities(location,hospital_limit=8,urgent_limit=8)
    if not facilities:
        facilities=nppes_zip_facilities(location,hospital_limit=8,urgent_limit=8)
    result=[]
    for facility in facilities:
        try: r=route(location,facility)
        except LiveSourceError: continue
        result.append({**facility,**r,"travel":travel(r,mode)})
    if not result: raise LiveSourceError("No routable facilities were returned by the live public sources.")
    result=[item for item in result if item["road_miles"] <= radius_miles+1]
    result.sort(key=lambda x:(x["kind"],x["travel"]["minutes"])); return {"location":location,"radius_miles":radius_miles,"facilities":result}

def cms_query(dataset,conditions,limit=15):
    params=[("limit",str(limit))]
    for i,(field,value,operator) in enumerate(conditions): params += [(f"conditions[{i}][property]",field),(f"conditions[{i}][value]",value),(f"conditions[{i}][operator]",operator)]
    return get_json(f"{CMS}/{dataset}/0",params).get("results",[])

def official_detail(name,city="",state=""):
    tokens=re.findall(r"[A-Za-z]+",name); query_name=" ".join(tokens[:3]) or name; source_state=state_code(state); city_cmp=city.casefold()
    cms=cms_query("xubh-q36u",[("facility_name",query_name,"contains"),("state",source_state or "NJ","=")]); cms_match=next((x for x in cms if not city_cmp or x.get("citytown","").casefold()==city_cmp),None)
    nppes_data=get_json(NPPES,{"version":"2.1","organization_name":name,"city":city,"state":source_state,"limit":20}).get("results",[]); nppes=next((x for x in nppes_data if x.get("basic",{}).get("organization_name","").casefold()==name.casefold()),None)
    official={"cms":None,"nppes":None,"ed_throughput":None}
    if cms_match:
        official["cms"]={k:cms_match.get(k,"") for k in ("facility_id","facility_name","hospital_type","hospital_ownership","emergency_services","hospital_overall_rating","telephone_number","meets_criteria_for_birthing_friendly_designation")}
        measures=cms_query("yv7e-xc69",[("facility_id",cms_match["facility_id"],"="),("measure_id","OP_18b","=")],3)
        if measures: official["ed_throughput"]={k:measures[0].get(k,"") for k in ("measure_name","score","start_date","end_date","footnote")}
    if nppes:
        address=next((a for a in nppes.get("addresses",[]) if a.get("address_purpose")=="LOCATION"),{}); basic=nppes.get("basic",{})
        official["nppes"]={"npi":nppes.get("number",""),"organization":basic.get("organization_name",""),"last_updated":basic.get("last_updated",""),"address":", ".join(filter(None,[address.get("address_1"),address.get("address_2"),address.get("city"),address.get("state"),address.get("postal_code")])),"phone":address.get("telephone_number",""),"taxonomies":[t.get("desc","") for t in nppes.get("taxonomies",[]) if t.get("desc")]}
    return official

def recommend(zip_code,mode,radius_miles=200):
    search=discover(zip_code,mode,radius_miles,"regional"); output=[]
    for facility in [x for x in search["facilities"] if x["kind"]=="hospital"]:
        official=official_detail(facility["name"],facility["city"],facility["state"]); ed=official.get("ed_throughput")
        try: historical=float(ed["score"]) if ed and str(ed.get("score","")).replace(".","",1).isdigit() else None
        except (TypeError,ValueError): historical=None
        score=round(facility["travel"]["minutes"]*.65+historical*.35,1) if official.get("cms") and historical is not None else None
        output.append({**facility,"official":official,"historical_ed_minutes":historical,"access_score":score})
    verified=sorted([x for x in output if x["access_score"] is not None],key=lambda x:x["access_score"]); referral=sorted([x for x in output if x["access_score"] is None],key=lambda x:x["travel"]["minutes"])
    return {"location":search["location"],"hospitals":verified+referral,"math":"access score = 0.65 × live travel minutes + 0.35 × CMS historical ED minutes; lower is better. A score appears only when a CMS match and dated ED measure are returned."}
