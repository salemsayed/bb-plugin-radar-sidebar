#!/usr/bin/env python3
import argparse
import html
import json
import gzip
import base64
import os
import subprocess
import time
import statistics
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--natural-wait', type=int, default=600)
parser.add_argument('--preflight', action='store_true')
parser.add_argument('--only', nargs='+', type=int, choices=range(1,10))
args = parser.parse_args()
selected=set(args.only or range(1,10))
if args.preflight and args.only:
    parser.error('--preflight and --only are mutually exclusive')
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=True)
helper = Path(__file__).with_name('live-scroll-browser.js').read_text()
rows = []
results = {'mode': 'preflight' if args.preflight else ('subset' if args.only else 'full'), 'rows': rows, 'postPolicy': 'At most three LONG posts for the whole matrix: both widths share one post per stimulus.', 'limitations': ['Phone is real Chrome mobile emulation, not native iOS. Background uses the visibility/focus event route.']}

def cli(*cmd):
    for attempt in range(3):
        result = subprocess.run(['bb', *cmd], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode == 0:
            return result.stdout
        if attempt < 2 and cmd[:2] != ('thread', 'tell') and 'Host is not connected' in result.stdout + result.stderr:
            time.sleep(5)
            continue
        raise subprocess.CalledProcessError(result.returncode, ['bb', *cmd], output=result.stdout, stderr=result.stderr)

def run(label, body):
    script = out / (label + '.js')
    page_name = 'radar-matrix-' + label.split('-')[0]
    page_helper = helper.replace("'radar-matrix'",json.dumps(page_name),1)
    prefix, payload = body.rsplit('console.log(JSON.stringify(', 1)
    if not payload.endswith('));'):
        raise ValueError('Live browser operation must end with its result')
    body = prefix + 'matrixResult=' + payload[:-3] + ';'
    bridge = 'let matrixResult;\n'
    emit = """
if(matrixResult){
 const compressed=await p.evaluate(async d=>{const bytes=new TextEncoder().encode(JSON.stringify(d));const data=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());let s='';for(const b of data)s+=String.fromCharCode(b);return btoa(s)},matrixResult);
 console.log(JSON.stringify({packed:compressed}));
}
"""
    script.write_text(page_helper + '\n' + bridge + body + emit)
    proc = subprocess.run(['bb', 'own-chrome', 'run', '--timeout', '90s', '--script-file', str(script)], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    raw = proc.stdout
    if proc.returncode:
        (out / (label + '.log')).write_text(raw)
        raise RuntimeError(raw)
    (out / (label + '.log')).write_text(raw)
    for line in reversed(raw.splitlines()):
        try:
            value = json.loads(line)
            if isinstance(value, dict) and 'packed' in value:
                value=json.loads(gzip.decompress(base64.b64decode(value['packed'])))
            if isinstance(value, dict) and 'result' in value:
                (out / (label + '-data.json')).write_text(json.dumps(value['result'],indent=2))
                if isinstance(value['result'], dict):
                    local_images=[]
                    if value['result'].get('imageInfo'):
                        transfer = """
const p=await browser.getPage(__PAGE__);
const paths=await p.evaluate(async config=>{
  const frames=JSON.parse(sessionStorage.getItem('radar-matrix-images')||'[]');
  const paths=[];
  for(let start=0;start<frames.length;start+=4){
    await Promise.all(frames.slice(start,start+4).map(async(data,j)=>{
      const path=config.root+'/'+config.label+'-cast-'+(start+j)+'.jpg';
      const response=await fetch('/api/v1/files/write',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({hostId:'host_vrvcsri4fm',rootPath:config.root,path,content:data,contentEncoding:'base64',createParents:true,mode:384})
      });
      if(!response.ok)throw Error('Artifact upload HTTP '+response.status);
      paths[start+j]=path;
    }));
  }
  return paths;
},__CONFIG__);
console.log(JSON.stringify({paths}));
""".replace('__PAGE__',json.dumps(page_name)).replace('__CONFIG__',json.dumps(dict(root=str(out),label=label)))
                        output=cli('own-chrome','run','--script',transfer)
                        (out/(label+'-transfer.log')).write_text(output)
                        local_images=next(json.loads(l)['paths'] for l in output.splitlines() if l.startswith('{"paths":'))
                    value['result']['frameImages'] = local_images
                return value['result']
        except ValueError:
            pass
    raise RuntimeError('No result in ' + label)

def visible_frame_time(data):
    samples = data['frames']
    checks = []
    for frame, path in zip(data['imageInfo'], data.get('frameImages', [])):
        if frame['ms'] < 0 and data.get('action') != 'resume':
            continue
        elapsed = max(0, frame['ms'])
        stamp = data['triggerAt'] + elapsed
        sample = min(samples, key=lambda item: abs(item['wallTime'] - stamp)) if samples else None
        bounds = data['expected'].get('bounds')
        if not sample or not sample['painted'] or not bounds:
            checks.append(dict(index=frame['index'], ms=elapsed, content=False))
            continue
        dimensions = subprocess.check_output(['magick', 'identify', '-format', '%w %h', path], text=True).split()
        scale = int(dimensions[0]) / frame['deviceWidth']
        left = round((bounds['left'] + 4) * scale)
        top = round((bounds['top'] + 8) * scale)
        width = max(1, round((bounds['width'] - 8) * scale))
        height = max(1, round(min(bounds['height'] * 0.75, bounds['height'] - 120) * scale))
        fraction = float(subprocess.check_output(['magick', path, '-crop', f'{width}x{height}+{left}+{top}', '-colorspace', 'Gray', '-threshold', '62%', '-format', '%[fx:1-mean]', 'info:'], text=True))
        content = fraction * width * height >= 150
        checks.append(dict(index=frame['index'], ms=elapsed, darkPixelFraction=fraction, content=content, offset=sample['offset'], bottomGap=sample['bottomGap']))
    data['compositorFrames'] = checks
    return next((frame['ms'] for frame in checks if frame['content']), None)

def reload_jump_count(data):
    visible_frame_time(data)
    correct = [frame.get('offset') is not None and abs(frame['offset']-data['expected']['offset'])<=8 for frame in data['compositorFrames'] if frame['content']]
    return sum(value and (index == 0 or not correct[index-1]) for index, value in enumerate(correct))

def later_blank_ms(data):
    seen = False
    started = None
    total = 0
    for frame in data['compositorFrames']:
        if frame['content']:
            seen = True
            if started is not None:
                total += frame['ms'] - started
                started = None
        elif seen and started is None:
            started = frame['ms']
    if started is not None:
        total += data['compositorFrames'][-1]['ms'] - started
    return total

def save():
    results['outcome'] = ('pass' if len(rows) == (2 if args.preflight else len(selected)*2) and not results.get('error') and results.get('settingsRestored') is True and all(r['status'] in ['pass', 'skip'] for r in rows) else 'fail') if results.get('finished') else 'running'
    (out / 'results.json').write_text(json.dumps(results, indent=2))
    sections=[]
    for r in rows:
        d=r['data']
        detail={k:v for k,v in d.items() if k not in ['frames','trace','frameImages','remoteFrameImages','imageInfo']}
        images=d.get('frameImages',r.get('frameImages',[]))
        gallery=''.join('<a href="'+html.escape(Path(i).name)+'"><img loading="lazy" src="'+html.escape(Path(i).name)+'"></a>' for i in images)
        sections.append('<details><summary>'+html.escape(f"{r['width']} / {r['scenario']}: {r['status']}")+'</summary><pre>'+html.escape(json.dumps(detail,indent=2))+'</pre><div>'+gallery+'</div></details>')
    (out/'frames.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Installed scroll matrix</title><style>body{font:16px system-ui;margin:24px}summary{padding:12px;cursor:pointer}pre{white-space:pre-wrap}img{max-width:300px;max-height:450px;margin:4px}details{border-bottom:1px solid #ccc}</style><h1>Installed scroll matrix</h1><p>'+html.escape(results['outcome'])+'</p>'+''.join(sections))

def row(width, scenario, data, ok, **extra):
    rows.append(dict(width=width, scenario=scenario, status='pass' if ok else 'fail', data=data, **extra))
    save()

def position_ok(d):
    return d['final']['offset'] is not None and abs(d['final']['offset'] - d['expected']['offset']) <= 8

def post(label):
    raw = cli('thread', 'tell', 'thr_yaa3n3kk73', 'Reply only ok. LONG scroll matrix ' + label + '\n' + '\n'.join(f'{i}. Reading position verification paragraph {label}: preserve the message and its pixel offset while new messages arrive.' for i in range(1, 61)))
    raw += cli('thread', 'wait', 'thr_yaa3n3kk73', '--timeout', '60s', '--json')
    (out / (label + '-post.log')).write_text(raw)

def setting(value):
    cli('plugin', 'config', 'radar-sidebar', 'set', 'rememberScroll', json.dumps(value))

cli('own-chrome','run','--wait','5m','--script','console.log("scroll matrix hold acquired")')
original = json.loads(cli('plugin', 'config', 'radar-sidebar', '--json'))['values']
results['originalSettings'] = original
results['installed'] = json.loads(cli('plugin', 'list', '--json'))
try:
    widths = [('phone', dict(width=390, height=844, isMobile=True, hasTouch=True)), ('desktop', dict(width=1280, height=900, isMobile=False, hasTouch=False))]
    if not args.preflight:
        setting(True)
        for scenario, phase in [(1,'return'),(2,'bottom'),(3,'background')]:
            if scenario not in selected:
                continue
            prepared = {}
            for width, viewport in widths:
                run(width+'-'+phase+'-viewport','await p.setViewport('+json.dumps(viewport)+');console.log(JSON.stringify({result:{ok:true}}));')
                body="const initial=await middle();await p.mouse.move(initial.rect.x,initial.rect.y);await p.mouse.wheel({deltaY:initial.offset});await pause(700);const before=await state();"
                if scenario==2:
                    body+='await p.evaluate(()=>{const b=document.querySelector(".thread-scrollbar");b.scrollTop=b.scrollHeight;});await pause(700);'
                body += "await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});"
                if scenario!=3:
                    body+='await away();'
                body+='console.log(JSON.stringify({result:before}));'
                prepared[width]=run(width+'-'+phase+'-before',body)
            if prepared['phone']['seq']!=prepared['desktop']['seq'] or abs(prepared['phone']['offset']-prepared['desktop']['offset'])>8:
                raise RuntimeError('Shared stimulus requires the same aligned message on both widths')
            post('both-'+phase)
            for width, _ in widths:
                data=run(width+'-'+phase+'-after','console.log(JSON.stringify({result:await measure('+json.dumps('resume' if scenario==3 else 'return')+','+json.dumps(prepared[width])+')}));')
                row(width,scenario,data,data['final']['bottomGap']<=24 if scenario==2 else position_ok(data))
                run(width+'-'+phase+'-freeze',"await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});console.log(JSON.stringify({result:{ok:true}}));")
    for width, viewport in [('phone', dict(width=390, height=844, isMobile=True, hasTouch=True)), ('desktop', dict(width=1280, height=900, isMobile=False, hasTouch=False))]:
        run(width+'-viewport', 'await p.setViewport('+json.dumps(viewport)+'); console.log(JSON.stringify({result:{ok:true}}));')
        setting(True)
        if args.preflight:
            before=run(width+'-preflight-before','console.log(JSON.stringify({result:await middle()}));')
            d=run(width+'-preflight','console.log(JSON.stringify({result:await measure("reload",'+json.dumps(before)+')}));')
            visible=[f for f in d['frames'] if f['painted']]
            wrong=[f for f in visible if f['offset'] is None or abs(f['offset']-before['offset'])>8]
            d['settlingMs']=max((f['ms'] for f in wrong),default=visible[0]['ms'] if visible else 0)-(visible[0]['ms'] if visible else 0)
            d['bottomFlashFrames']=sum(f['bottomGap'] is not None and f['bottomGap']<=24 for f in visible)
            d['jumpCount']=reload_jump_count(d)
            row(width,4,d,position_ok(d) and d['jumpCount']==1)
            continue
        if 4 in selected:
            before = run(width+'-reload-before', 'console.log(JSON.stringify({result:await middle()}));')
            data = run(width+'-reload', 'console.log(JSON.stringify({result:await measure("reload",'+json.dumps(before)+')}));')
            data['jumpCount']=reload_jump_count(data)
            row(width, 4, data, position_ok(data) and data['jumpCount']==1)
        if 5 in selected:
            two = run(width+'-two', 'const a=await middle();const b=await middle("thr_wfhsqd493j",false);await route("/projects/proj_jfxygzbhcr/threads/"+thread);await p.waitForFunction((t,seq)=>document.querySelector(`[data-notification-thread="${t}"][data-notification-message="${seq}"]`),{timeout:9000},thread,a.seq);await pause(200);const aa=await state(thread,a.seq);await route("/projects/proj_jfxygzbhcr/threads/thr_wfhsqd493j");await p.waitForFunction((t,seq)=>document.querySelector(`[data-notification-thread="${t}"][data-notification-message="${seq}"]`),{timeout:9000},"thr_wfhsqd493j",b.seq);await pause(200);const bb=await state("thr_wfhsqd493j",b.seq);const ev=await measure("none",b,"thr_wfhsqd493j");console.log(JSON.stringify({result:{a,b,aa,bb,...ev}}));')
            row(width, 5, two, all(two[k+'a' if k=='a' else 'bb']['offset'] is not None for k in ['a','b']) and abs(two['a']['offset']-two['aa']['offset'])<=8 and abs(two['b']['offset']-two['bb']['offset'])<=8)
        if 6 in selected:
            action = run(width+'-action', 'await middle();await away();await p.goBack();await p.waitForFunction(()=>document.querySelector(".thread-scrollbar"));const s=await state();await p.mouse.move(s.rect.x,s.rect.y);await p.mouse.wheel({deltaY:300});await pause(300);const a=await state();await pause(1600);const b=await state(thread,a.seq);const ev=await measure("none",a);const saved=await middle();await p.reload({waitUntil:"domcontentloaded"});await p.waitForFunction(seq=>location.hash==="#msg="+seq&&!document.querySelector(`[data-notification-thread="thr_yaa3n3kk73"][data-notification-message="${seq}"]`)&&document.querySelector(".thread-scrollbar"),{timeout:10000},saved.seq);const normal=await state();await p.mouse.move(normal.rect.x,normal.rect.y);await p.mouse.wheel({deltaY:-300});await pause(300);const user=await state();const cold=await measure("none",user);console.log(JSON.stringify({result:{a,b,warm:ev,...cold,cold:{saved,...cold}}}));')
            row(width, 6, action, action['b']['offset'] is not None and abs(action['a']['offset']-action['b']['offset'])<=8 and position_ok(action['cold']) and action['cold']['expected']['bottomGap']>200)
        if 7 in selected:
            timings = {}
            trials = {}
            for mode in [False, True]:
                setting(mode)
                timings[str(mode)] = {}
                trials[str(mode)] = {}
                for action in ['return', 'reload', 'resume']:
                    samples = []
                    for trial in range(3 if action == 'reload' else 1):
                        label = width+'-flicker-'+str(mode)+'-'+action+('' if trial == 0 else '-trial-'+str(trial+1))
                        setup = 'const a=await middle();'
                        if action=='return':
                            setup += 'await away();'
                        if action=='resume':
                            setup += "await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});await pause(500);"
                        before = run(label+'-before', setup+'console.log(JSON.stringify({result:a}));')
                        sample = run(label, 'console.log(JSON.stringify({result:await measure('+json.dumps(action)+','+json.dumps(before)+')}));')
                        sample['firstCompositorMs'] = visible_frame_time(sample)
                        sample['source'] = str(out/(label+'-data.json'))
                        samples.append(sample)
                    trials[str(mode)][action] = samples
                    timings[str(mode)][action] = sorted(samples, key=lambda d: d['firstCompositorMs'] if d['firstCompositorMs'] is not None else float('inf'))[len(samples)//2]
            first = lambda data: data['firstCompositorMs']
            comparisons = {}
            for action in ['return', 'reload', 'resume']:
                off, on = first(timings['False'][action]), first(timings['True'][action])
                data = timings['True'][action]
                wrong = [f for f in data['frames'] if f['painted'] and f['bottomGap'] is not None and f['bottomGap']<=24 and data['expected']['bottomGap']>40]
                shifted = [f for f in data['frames'] if f['painted'] and (f['offset'] is None or abs(f['offset']-data['expected']['offset'])>8)]
                first_dom = next((f['ms'] for f in data['frames'] if f['painted']), 0)
                settling = max((f['ms'] for f in shifted), default=first_dom)-first_dom
                correct=[f.get('offset') is not None and abs(f['offset']-data['expected']['offset'])<=8 for f in data['compositorFrames'] if f['content']]
                jumps=sum(value and (i==0 or not correct[i-1]) for i,value in enumerate(correct))
                comparisons[action] = dict(laterBlankOffMs=later_blank_ms(timings['False'][action]),laterBlankOnMs=later_blank_ms(data),jumpCount=jumps,landingErrorPx=None if data['final']['offset'] is None else abs(data['final']['offset']-data['expected']['offset']),offMs=off,onMs=on,extraMs=None if off is None or on is None else on-off,bottomFlashFrames=len(wrong),settlingMs=settling,wrongPositionFrames=len(shifted),offFrames=timings['False'][action]['compositorFrames'],onFrames=data['compositorFrames'])
            reload_trials = []
            for sample in trials['True']['reload']:
                native = next((e['wallTime'] for e in sample['trace'] if e['event']=='native-visible'), None)
                operation = next((e['wallTime'] for e in sample['trace'] if e['event'] in ['load-anchor','adjust']), None)
                first_dom = next((f['wallTime'] for f in sample['frames'] if f['painted']), None)
                jumps = reload_jump_count(sample)
                error = None if sample['final']['offset'] is None else abs(sample['final']['offset']-sample['expected']['offset'])
                ordering = native is not None and operation is not None and first_dom is not None and operation-native>=35 and first_dom<=operation and sample['firstCompositorMs'] is not None and sample['triggerAt']+sample['firstCompositorMs']<=operation+120
                reload_trials.append(dict(source=sample['source'],firstCompositorMs=sample['firstCompositorMs'],nativeVisibleWallTime=native,firstDomWallTime=first_dom,requestWallTime=operation,requestAfterNativeView=ordering,jumpCount=jumps,landingErrorPx=error,laterBlankMs=later_blank_ms(sample)))
            comparisons['reload']['samplesOffMs'] = [d['firstCompositorMs'] for d in trials['False']['reload']]
            comparisons['reload']['samplesOnMs'] = [d['firstCompositorMs'] for d in trials['True']['reload']]
            comparisons['reload']['sampling'] = 'Median of three end-to-end reloads per mode; every enabled reload must satisfy ordering, one jump, landing and later-blank requirements.'
            comparisons['reload']['enabledTrials'] = reload_trials
            comparisons['reload']['allTrialsPass'] = all(d['requestAfterNativeView'] and d['jumpCount']==1 and d['landingErrorPx'] is not None and d['landingErrorPx']<=8 and d['laterBlankMs']<=150 for d in reload_trials)
            row(width, 7, comparisons, all(d['extraMs'] is not None and d['extraMs']+max(0,d['laterBlankOnMs']-d['laterBlankOffMs'])<=150 and (d['allTrialsPass'] if action=='reload' else not d['bottomFlashFrames'] and d['settlingMs']<=150) for action,d in comparisons.items()),frameImages=[i for samples in trials['True'].values() for d in samples for i in d.get('frameImages',[])])
        if 8 in selected:
            setting(False)
            off = run(width+'-switch-off', 'const a=await middle();const cache=a.cache;const d=await measure("reload",a);console.log(JSON.stringify({result:{cache,after:d.final.cache,bottomGap:d.final.bottomGap,frames:d.frames,imageInfo:d.imageInfo}}));')
            row(width, 8, off, off['cache']==off['after'] and off['bottomGap'] is not None and off['bottomGap']<=24)
        if 9 in selected:
            setting(True)
            natural = run(width+'-natural-before', 'console.log(JSON.stringify({result:await middle("thr_exqyeqrqpy")}));')
            started = time.monotonic()
            initial = cli('thread','log','thr_exqyeqrqpy','--format','minimal','--limit','1')
            run(width+'-natural-away', 'await away();console.log(JSON.stringify({result:{ok:true}}));')
            observed = False
            while time.monotonic()-started < args.natural_wait:
                time.sleep(min(30, args.natural_wait))
                cli('own-chrome','run','--script','console.log("scroll matrix observation heartbeat")')
                if cli('thread','log','thr_exqyeqrqpy','--format','minimal','--limit','1') != initial:
                    observed = True
                    break
            d = run(width+'-natural-after', 'console.log(JSON.stringify({result:await measure("return",'+json.dumps(natural)+',"thr_exqyeqrqpy")}));')
            row(width,9,d,position_ok(d),naturalPostObserved=observed,waitedSeconds=round(time.monotonic()-started))
            if not observed:
                rows[-1]['status']='skip'
                rows[-1]['reason']='No natural Lab post within observation window'
            save()
        run(width+'-finished-freeze',"await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});console.log(JSON.stringify({result:{ok:true}}));")
except Exception as e:
    results['error'] = str(e)
finally:
    setting(original['rememberScroll'])
    results['settingsRestored'] = json.loads(cli('plugin','config','radar-sidebar','--json'))['values']==original
    results['release'] = cli('own-chrome','release')
    results['finished'] = True
    save()
print(out/'results.json')
raise SystemExit(0 if results['outcome']=='pass' else 1)
