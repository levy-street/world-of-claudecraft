from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
BASE=Path('E:/woc/entregas/santuario/trash')
TMP=ROOT/'tmp/cultistas'
SPECS={
 'thawcaller':dict(title='Broodsworn Thawcaller',height=4.4,scale=1.6,width=1.0,
  cloth=(.19,.25,.25),leather=(.22,.095,.042),fur=(.43,.37,.28),
  clips={'Idle':3.2,'Walk':1.2,'Run':.6,'Attack':1.4,'Attack2':1.5,'Cast':2.,'WarmingRite':3.2,'ThawTheHeld':3.8,'Hit':.7,'Death':3.}),
 'goadsmith':dict(title='Broodsworn Goadsmith',height=4.6,scale=1.75,width=1.27,
  cloth=(.10,.135,.14),leather=(.30,.12,.047),fur=(.17,.10,.065),
  clips={'Idle':3.2,'Walk':1.2,'Run':.6,'Attack':1.4,'Cast':2.,'Goad':2.7,'ReRivet':6.6,'Hit':.7,'Death':3.}),
 'pyre_tender':dict(title='Broodsworn Pyre-Tender',height=4.4,scale=1.65,width=.93,
  cloth=(.055,.065,.08),leather=(.13,.065,.035),fur=(.24,.27,.28),
  clips={'Idle':3.2,'Walk':1.2,'Run':.6,'Attack':1.4,'Cast':2.,'PlantBrazier':2.2,'Hit':.7,'Death':3.})}
LOOPS={'Idle','Walk','Run','Cast'}
CONTACTS={'Attack':.8,'Attack2':26/30,'WarmingRite':2.5,'ThawTheHeld':3.,'Goad':2.,'ReRivet':6.,'PlantBrazier':1.5}
STANCE=2/3
WALK_SPEED=.9/(1.2*STANCE)
RUN_SPEED=1.8/(.6*STANCE)
