#!/usr/bin/env python3
"""Export real upstream OpenSCAD solids as compact indexed JSON for WebGL."""
import json, pathlib, struct, subprocess, tempfile
root=pathlib.Path(__file__).resolve().parent
out={"format":"deckard-cad-v1","source":"https://github.com/deckar01/3x3x3-cube-puzzle","license":"MIT","copyright":"Copyright (c) 2017 Jared Deckard","widthMm":57,"parts":{}}
with tempfile.TemporaryDirectory() as tmp:
    for name in ("core","center","edge","corner"):
        path=pathlib.Path(tmp)/(name+".stl")
        subprocess.run(["openscad","--export-format","binstl","-o",str(path),str(root/"pieces"/(name+".scad"))],check=True)
        raw=path.read_bytes()
        count=struct.unpack_from("<I",raw,80)[0]
        assert len(raw)==84+50*count, "Invalid binary STL"
        verts=[]; faces=[]; index={}
        for i in range(count):
            vals=struct.unpack_from("<12fH",raw,84+50*i)
            for j in (3,6,9):
                v=tuple(round(x,5) for x in vals[j:j+3])
                if v not in index:
                    index[v]=len(verts)//3
                    verts.extend(v)
                faces.append(index[v])
        out["parts"][name]={"vertices":verts,"faces":faces}
        print(name,count,"triangles")
(root/"meshes.json").write_text(json.dumps(out,separators=(",",":"))+"\n")
