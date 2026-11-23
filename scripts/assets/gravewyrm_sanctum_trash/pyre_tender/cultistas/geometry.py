"""Original low polygon primitives, combined into one skinned mesh per surface."""
import math
import bpy
from mathutils import Vector, Matrix


def material(name, color, metal=0.0, rough=.4, emission=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    return m


class Batch:
    def __init__(self, name, mat):
        self.name, self.mat = name, mat
        self.vertices, self.faces, self.weights = [], [], []

    def add(self, vertices, faces, weights, matrix=None):
        offset = len(self.vertices)
        self.vertices.extend([tuple(matrix @ Vector(v)) if matrix else tuple(v) for v in vertices])
        self.faces.extend([tuple(offset + i for i in face) for face in faces])
        self.weights.extend([dict(weights) for _ in vertices] if isinstance(weights, dict) else weights)

    def ellipsoid(self, center, radii, weights, segments=10, rings=6, matrix=None):
        vertices = []
        for r in range(rings + 1):
            phi = math.pi * r / rings
            for s in range(segments):
                t = math.tau * s / segments
                vertices.append(tuple(center[k] + radii[k] * q for k, q in enumerate(
                    (math.sin(phi) * math.cos(t), math.sin(phi) * math.sin(t), math.cos(phi)))))
        faces = []
        for r in range(rings):
            for s in range(segments):
                a, b = r*segments+s, r*segments+(s+1)%segments
                c, d = a+segments, b+segments
                if r: faces.append((a,c,b))
                if r != rings-1: faces.append((b,c,d))
        self.add(vertices, faces, weights, matrix)

    def cone(self, a, b, radius, weights, sides=7, tip=.0):
        a, b = Vector(a), Vector(b)
        direction = (b-a).normalized()
        u = direction.cross(Vector((0,0,1)))
        if u.length < .01: u = direction.cross(Vector((1,0,0)))
        u.normalize(); v = direction.cross(u).normalized()
        vertices = [tuple(p + rad*(u*math.cos(math.tau*i/sides)+v*math.sin(math.tau*i/sides)))
                    for p,rad in [(a,radius),(b,tip)] for i in range(sides)]
        faces = [tuple(reversed(range(sides)))]
        for i in range(sides):
            j=(i+1)%sides
            faces.extend([(i,j,i+sides),(j,j+sides,i+sides)])
        if tip: faces.append(tuple(range(sides,2*sides)))
        self.add(vertices, faces, weights)

    def ribbon(self, centers, widths, weights, axis=(0,0,1)):
        vs=[]; faces=[]; ws=[]
        for i,p in enumerate(centers):
            v=Vector(axis)*widths[i]
            vs.extend([tuple(Vector(p)-v),tuple(Vector(p)+v)])
            ws.extend([weights,weights] if isinstance(weights,dict) else [weights[i],weights[i]])
            if i: faces.extend([(2*i-2,2*i,2*i-1),(2*i-1,2*i,2*i+1)])
        self.add(vs,faces,ws)

    def finish(self, collection, rig=None):
        if not self.vertices: return None
        mesh=bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces); mesh.update()
        obj=bpy.data.objects.new(self.name,mesh); collection.objects.link(obj)
        obj.data.materials.append(self.mat)
        for poly in mesh.polygons: poly.use_smooth=False
        if rig:
            groups={name: obj.vertex_groups.new(name=name) for name in sorted({n for ws in self.weights for n in ws})}
            for i,ws in enumerate(self.weights):
                for name,value in ws.items():
                    if value>0: groups[name].add([i],value,'REPLACE')
            mod=obj.modifiers.new('Ysolei_Skin','ARMATURE'); mod.object=rig
            obj.parent=rig
        return obj


def collection(name):
    c=bpy.data.collections.new(name); bpy.context.scene.collection.children.link(c); return c


def catmull(points, steps=8):
    p=[Vector(points[0])]+[Vector(v) for v in points]+[Vector(points[-1])]
    result=[]
    for i in range(1,len(p)-2):
        for k in range(steps):
            t=k/steps
            a,b,c,d=p[i-1:i+3]
            result.append((2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)*.5)
    result.append(Vector(points[-1])); return result


def resample(points,count):
    distances=[0.]
    for a,b in zip(points,points[1:]): distances.append(distances[-1]+(b-a).length)
    result=[]; j=0
    for i in range(count):
        d=distances[-1]*i/(count-1)
        while j<len(points)-2 and distances[j+1]<d: j+=1
        t=(d-distances[j])/max(1e-8,distances[j+1]-distances[j])
        result.append(points[j].lerp(points[j+1],t))
    return result


def frame_at(path,i):
    tangent=(path[min(i+1,len(path)-1)]-path[max(0,i-1)]).normalized()
    u=tangent.cross(Vector((0,0,1)))
    if u.length<.1: u=tangent.cross(Vector((0,1,0)))
    u.normalize(); v=u.cross(tangent).normalized()
    return tangent,u,v


def tube(batch, points, radii, weights, sides=14):
    vs=[]; ws=[]; fs=[];previous_u=None
    for i,p in enumerate(points):
        tangent=(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        seed=previous_u if previous_u is not None else Vector((1,0,0))
        u=seed-tangent*seed.dot(tangent)
        if u.length<.01:u=Vector((0,1,0))-tangent*tangent.y
        u.normalize();v=tangent.cross(u).normalized();previous_u=u
        for j in range(sides):
            t=math.tau*j/sides
            vs.append(tuple(p+radii[i]*(u*math.cos(t)+v*math.sin(t))))
            ws.append(weights[i])
        if i:
            for j in range(sides):
                a=(i-1)*sides+j; b=(i-1)*sides+(j+1)%sides; c=i*sides+j; d=i*sides+(j+1)%sides
                fs.extend([(a,b,c),(b,d,c)])
    fs.extend([tuple(reversed(range(sides))),tuple(range((len(points)-1)*sides,len(points)*sides))])
    batch.add(vs,fs,ws)


def patch(batch, points, weight):
    """A beveled spear-shaped plate with a raised center and dark exposed edge."""
    center=sum((Vector(p) for p in points),Vector())/len(points)
    normal=(Vector(points[1])-Vector(points[0])).cross(Vector(points[2])-Vector(points[0])).normalized()
    vs=list(points)+[tuple(center+normal*.07)]
    batch.add(vs,[(i,(i+1)%len(points),len(points)) for i in range(len(points))],weight)
