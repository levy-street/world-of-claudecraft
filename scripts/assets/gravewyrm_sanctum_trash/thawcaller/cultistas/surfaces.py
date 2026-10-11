"""Deterministic authored textile/leather maps, embedded and later converted to KTX2."""
import bpy,math
import numpy as np
from geometry import material

def materials(spec,out):
    palette={'Cloth':spec['cloth'],'Leather':spec['leather'],'Fur':spec['fur'],
      'Skin':(.36,.245,.205),'Iron':(.105,.14,.16),'Bone':(.57,.48,.32),
      'Frost':(.47,.66,.73),'Soul':(.09,.65,.70),'Ember':(1.,.20,.025),'Dark':(.017,.02,.022)}
    mats={}
    y,x=np.mgrid[0:512,0:512];rng=np.random.default_rng(713)
    noise=rng.random((512,512));grain=.82+.18*noise
    for name,color in palette.items():
        m=material(name,color,.65 if name=='Iron' else .0,.76 if name not in ('Iron','Soul','Ember') else .38,
          3.5 if name=='Soul' else 5 if name=='Ember' else 0)
        if name in ('Cloth','Leather','Fur','Skin','Iron'):
            weave=(np.sin(x*math.tau/8)*np.cos(y*math.tau/8))*.055
            broad=.91+.09*np.sin(x*.067+np.sin(y*.026))*np.sin(y*.053)
            pattern=grain*broad+(weave if name in ('Cloth','Fur') else .025*np.sin(y*.36+noise*3))
            img=bpy.data.images.new(name+'_authored',512,512,alpha=True)
            rgba=np.ones((512,512,4),dtype=np.float32)
            for k in range(3):rgba[:,:,k]=np.clip(color[k]*pattern,0,1)
            img.pixels.foreach_set(rgba.ravel());img.filepath_raw=str(out/(name.lower()+'.png'))
            img.file_format='PNG';img.save();img.pack()
            tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=img
            m.node_tree.links.new(tex.outputs['Color'],m.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        mats[name]=m
    return mats

def uv_and_finish(batch,col,rig,smooth=True):
    obj=batch.finish(col,rig)
    if not obj:return
    uv=obj.data.uv_layers.new(name='AuthoredUV')
    for poly in obj.data.polygons:
        poly.use_smooth=smooth
        axis=max(range(3),key=lambda a:abs(poly.normal[a]));plane=[a for a in range(3) if a!=axis]
        for li in poly.loop_indices:
            v=obj.data.vertices[obj.data.loops[li].vertex_index].co
            uv.data[li].uv=(v[plane[0]]*1.7,v[plane[1]]*1.7)
    return obj
