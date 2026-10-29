# Builds assets/3d/cakes.glb — the Petite and tiered cake parts for the 3D designer (bento-scene.js).
# Run:  blender -b --python assets/3d/source/cakes_build.py      (takes a few seconds)
# Units are metres (1 inch = 0.0254). Every part is centred on the origin, standing on z = 0; the web preview places,
# scales and colours them. Names (W, H in inches, 2.5 written 2_5):
#   body_d<W>_h<H>   one tier with a softly rounded top edge
#   shell_d<W>       a ring of star-tip piped shells for a tier W inches wide (top or bottom edge)
#   drip_d<W>_h<H>   a ganache drip over the top edge of a W×H tier
# Sizes: Petite 4x4, 6x4, 8x4 · Mini Tiered 4x4 + 2x2, 6x4 + 4x2 · Mini 3-Tiered 8x4 + 6x4 + 4x2.
import bpy, bmesh, math, random, os
from mathutils import Matrix, Vector

IN = 0.0254
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cakes.glb')
BODIES = [(2, 2), (4, 2), (4, 4), (6, 4), (8, 4)]
WIDTHS = sorted({w for w, _ in BODIES})
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

def to_object(bm, name, mat):
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

for w, h in BODIES: body(w, h); drip_ring(w, h)
for w in WIDTHS: shell_ring(w)

for o in scene.objects: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', use_selection=True, export_apply=True,
                          export_yup=True, export_normals=True, export_materials='EXPORT')
for o in sorted(scene.objects, key=lambda o: o.name): print('PART', o.name, len(o.data.polygons), tuple(round(v, 4) for v in o.dimensions))
print('EXPORTED', os.path.abspath(OUT), 'faces', sum(len(o.data.polygons) for o in scene.objects))
