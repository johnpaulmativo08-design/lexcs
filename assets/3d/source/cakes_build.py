# Builds assets/3d/cakes.glb — the Petite and tiered cake parts for the 3D designer (bento-scene.js).
# Run:  blender -b --python assets/3d/source/cakes_build.py      (takes a few seconds)
# Units are metres (1 inch = 0.0254). Every part is centred on the origin, standing on z = 0; the web preview places,
# scales and colours them. Names (W, H in inches, 2.5 written 2_5):
#   body_d<W>_h<H>   one tier with a softly rounded top edge
#   shell_d<W>       a ring of star-tip piped shells for a tier W inches wide (top or bottom edge)
#   drip_d<W>_h<H>   a ganache drip over the top edge of a W×H tier
#   sponge_d<W>      one sponge cake layer (the "cake base"), 0.66" tall, golden crumb sides and a slightly domed top
#   filling_d<W>     the filling on top of a sponge, 0.34" tall: a flat cream disc ringed by a piped swirl rope
#                    (one sponge + its filling = 1"; the preview stacks one pair per inch of tier height)
# Sizes: Petite 4x4, 6x4, 8x4 · Mini Tiered 4x4 + 2x2, 6x4 + 4x2, 8x4 + 6x4 + 4x2 · bento 4x2.
import bpy, bmesh, math, random, os
from mathutils import Matrix, Vector, noise

IN = 0.0254
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cakes.glb')
BODIES = [(2, 2), (4, 2), (4, 4), (6, 4), (8, 4)]
WIDTHS = sorted({w for w, _ in BODIES})
LAYER_WIDTHS = [2, 2.75, 4, 6, 8]                 # 2.75: top tier of the 4x4 Mini Tiered
SPONGE_H, FILLING_H = 0.66 * IN, 0.34 * IN
tag = lambda v: (str(v).replace('.', '_') if v != int(v) else str(int(v)))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def material(name, rgb, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1); bsdf.inputs['Roughness'].default_value = rough
    return m
FROST = material('Frosting_White', (0.93, 0.91, 0.87), 0.55)
SHELL = material('Shell_Frosting', (0.95, 0.93, 0.89), 0.5)
DRIP = material('Drip_Berry', (0.62, 0.02, 0.05), 0.25)
SPONGE = material('Sponge_Golden', (0.86, 0.6, 0.27), 0.85)
FILLING = material('Filling_Cream', (0.97, 0.94, 0.86), 0.45)

def to_object(bm, name, mat):
    if bm.calc_volume(signed=True) < 0: bmesh.ops.reverse_faces(bm, faces=bm.faces)   # faces must point outward (the web preview culls back faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    obj = bpy.data.objects.new(name, me); scene.collection.objects.link(obj)
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return obj

def body(w, h):
    """A straight-sided tier: lathe profile with a rounded top edge (r ≈ 0.18") and a tiny base edge."""
    r, hh, bev = w * IN / 2, h * IN, 0.0045
    prof = [(0, 0), (r - 0.0008, 0), (r, 0.0008)]
    for k in range(13):
        a = k / 12 * math.pi / 2
        prof.append((r - bev + bev * math.cos(a), hh - bev + bev * math.sin(a)))
    prof.append((0, hh))
    bm = bmesh.new(); seg = 128
    rings = []
    for i in range(seg):
        a = i / seg * 2 * math.pi
        rings.append([bm.verts.new((x * math.cos(a), x * math.sin(a), z)) for x, z in prof])
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for j in range(len(prof) - 1):
            if prof[j][0] == 0 and prof[j + 1][0] == 0: continue
            vs = [A[j], B[j], B[j + 1], A[j + 1]]
            if prof[j][0] == 0: vs = [A[j], B[j + 1], A[j + 1]]          # bottom centre fan
            elif prof[j + 1][0] == 0: vs = [A[j], B[j], A[j + 1]]        # top centre fan
            try: bm.faces.new(vs)
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return to_object(bm, f'body_d{tag(w)}_h{tag(h)}', FROST)

def shell_template(bm, size):
    """One star-tip shell lying along +X: fat head at the origin tapering to a tail, with 8 piping ridges."""
    geom = bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=9, radius=1)
    vs = geom['verts']
    for v in vs:
        x, y, z = v.co
        t = (x + 1) / 2                                   # 0 head side … 1 tail side
        taper = 1 - 0.78 * t ** 1.6
        ang = math.atan2(z, y); ridge = 1 + 0.09 * math.cos(8 * ang)
        v.co = Vector((x * 1.55 * size, y * taper * ridge * 0.95 * size, max(z, -0.55) * taper * ridge * 0.8 * size))
    return vs

def shell_ring(w):
    r, size = w * IN / 2, 0.0058                          # shell ≈ 0.45" wide, 0.3" tall, like the reference's border
    n = max(12, round(2 * math.pi * r / (size * 2.0)))
    bm = bmesh.new()
    for i in range(n):
        a = i / n * 2 * math.pi
        vs = shell_template(bm, size)
        bmesh.ops.translate(bm, vec=(0, 0, size * 0.55), verts=vs)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2 + 0.12, 3, 'Z'), verts=vs)   # along the edge
        bmesh.ops.translate(bm, vec=(r, 0, 0), verts=vs)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, 'Z'), verts=vs)
    return to_object(bm, f'shell_d{tag(w)}', SHELL)

def drip_ring(w, h):
    """A rounded band hugging the top edge, with drops of uneven length ending in a round bead."""
    rnd = random.Random(int(w * 100 + h))
    r, top, t = w * IN / 2 + 0.0006, h * IN, 0.0027
    bm = bmesh.new()
    band = bmesh.ops.create_cone(bm, cap_ends=False, segments=128, radius1=r + 0.0009, radius2=r + 0.0009, depth=0.0055)['verts']
    bmesh.ops.translate(bm, vec=(0, 0, top - 0.0026), verts=band)
    lip = bmesh.ops.create_circle(bm, cap_ends=True, segments=128, radius=r + 0.0004)['verts']   # glaze on top
    bmesh.ops.translate(bm, vec=(0, 0, top + 0.0003), verts=lip)
    n = max(14, round(2 * math.pi * r / 0.0105))
    for i in range(n):
        a = (i + rnd.uniform(-0.2, 0.2)) / n * 2 * math.pi
        length = (0.005 + rnd.random() * 0.014) * (1.3 if h >= 4 else 1.0)
        stem = bmesh.ops.create_cone(bm, cap_ends=False, segments=14, radius1=t * 0.92, radius2=t * 1.2, depth=length)['verts']   # wider where it leaves the band
        bmesh.ops.translate(bm, vec=(0, 0, top - 0.002 - length / 2), verts=stem)
        bead = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=t * 0.98)['verts']   # a soft rounded end, not a ball
        bmesh.ops.translate(bm, vec=(0, 0, top - 0.002 - length), verts=bead)
        for vs in (stem, bead):
            bmesh.ops.translate(bm, vec=(r, 0, 0), verts=vs)
            bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(a, 3, 'Z'), verts=vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return to_object(bm, f'drip_d{tag(w)}_h{tag(h)}', DRIP)

def sponge(w):
    """A baked layer: straight crumb sides with small pits and bumps, softly rounded edges, a barely domed top."""
    r, hh = w * IN / 2, SPONGE_H
    seg, rings = 112, 18
    bm = bmesh.new()
    prof = [(0.0, 0.0)] + [(r - 0.0012 + 0.0012 * math.sin(k / 3 * math.pi / 2), 0.0012 * (1 - math.cos(k / 3 * math.pi / 2))) for k in range(1, 4)]
    prof += [(r, hh * k / rings) for k in range(1, rings)]
    prof += [(r - 0.0016 + 0.0016 * math.cos(k / 4 * math.pi / 2), hh - 0.0016 + 0.0016 * math.sin(k / 4 * math.pi / 2)) for k in range(5)]
    prof += [(r * f, hh + 0.0006 * (1 - f * f)) for f in (0.75, 0.5, 0.25)] + [(0.0, hh + 0.0006)]
    grid = []
    for i in range(seg):
        a = i / seg * 2 * math.pi; ring = []
        for j, (x, z) in enumerate(prof):
            side = 0 < x and 0.0015 < z < hh - 0.0012            # crumb texture only on the sides
            if side:
                n = noise.noise(Vector((math.cos(a) * 5, math.sin(a) * 5, z / IN * 7)))   # soft, uneven baked sides
                x = x + 0.00035 * n
            ring.append(bm.verts.new((x * math.cos(a), x * math.sin(a), z)))
        grid.append(ring)
    for i in range(seg):
        A, B = grid[i], grid[(i + 1) % seg]
        for j in range(len(prof) - 1):
            if prof[j][0] == 0: bm.faces.new([A[j], B[j + 1], A[j + 1]]); continue
            if prof[j + 1][0] == 0: bm.faces.new([A[j], B[j], A[j + 1]]); continue
            bm.faces.new([A[j], B[j], B[j + 1], A[j + 1]])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.new()                         # wrap-around UVs for the crumb texture (u = angle, v = height)
    for f in bm.faces:
        us = [(math.atan2(l.vert.co.y, l.vert.co.x) / (2 * math.pi)) % 1.0 for l in f.loops]
        if max(us) - min(us) > 0.5: us = [u + 1 if u < 0.5 else u for u in us]
        for l, u in zip(f.loops, us): l[uv].uv = (u, l.vert.co.z / hh)
    return to_object(bm, f'sponge_d{tag(w)}', SPONGE)

def filling(w):
    """Cream between layers: a flat disc and, around its edge, a twisted piped rope that bulges just past the sponge."""
    r, hh = w * IN / 2, FILLING_H
    rope = hh * 0.6                                      # rope radius: a little more than half the layer, so it bulges
    bm = bmesh.new()
    disc = bmesh.ops.create_cone(bm, cap_ends=True, segments=128, radius1=r - rope * 0.6, radius2=r - rope * 0.6, depth=hh * 0.86)['verts']
    bmesh.ops.translate(bm, vec=(0, 0, hh * 0.43), verts=disc)
    seg = max(128, round(2 * math.pi * r / 0.0017)); cs = 16; twist = 2 * math.pi * r / (rope * 2.6)   # one twist per ~1.3 rope widths
    rings = []
    for i in range(seg):
        a = i / seg * 2 * math.pi; ring = []
        cx, cz = r - rope * 0.15, hh * 0.5
        for k in range(cs):
            t = k / cs * 2 * math.pi
            ridge = 1 + 0.24 * math.cos(6 * t + twist * a)       # six piping ridges spiralling round the rope
            rr = rope * ridge
            x, z = cx + rr * math.cos(t), cz + rr * 0.82 * math.sin(t)
            ring.append(bm.verts.new((x * math.cos(a), x * math.sin(a), max(0.0, z))))
        rings.append(ring)
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % seg]
        for k in range(cs):
            bm.faces.new([A[k], B[k], B[(k + 1) % cs], A[(k + 1) % cs]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return to_object(bm, f'filling_d{tag(w)}', FILLING)

for w, h in BODIES: body(w, h); drip_ring(w, h)
for w in LAYER_WIDTHS: sponge(w); filling(w)
for w in WIDTHS: shell_ring(w)

for o in scene.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_normals=True, export_materials='EXPORT')
for o in sorted(scene.objects, key=lambda o: o.name): print('PART', o.name, len(o.data.polygons), tuple(round(v, 4) for v in o.dimensions))
print('EXPORTED', os.path.abspath(OUT), 'faces', sum(len(o.data.polygons) for o in scene.objects))
