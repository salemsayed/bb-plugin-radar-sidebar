#!/usr/bin/env python3
import argparse
import json
import gzip
import base64
import os
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--natural-wait', type=int, default=600)
parser.add_argument('--preflight', action='store_true')
args = parser.parse_args()
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=True)
helper = Path(__file__).with_name('live-scroll-browser.js').read_text()
rows = []
results = {'mode': 'preflight' if args.preflight else 'full', 'rows': rows, 'postPolicy': 'At most three LONG posts for the whole matrix: both widths share one post per stimulus.', 'limitations': ['Phone is real Chrome mobile emulation, not native iOS. Background uses the visibility/focus event route.']}

def cli(*cmd):
    return subprocess.check_output(['bb', *cmd], text=True)

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
                    for image in value['result'].get('imageInfo', []):
                        chunks=[]
                        for start in range(0,image['length'],20000):
                            command='const p=await browser.getPage('+json.dumps(page_name)+');console.log(JSON.stringify({chunk:await p.evaluate(x=>JSON.parse(sessionStorage.getItem("radar-matrix-images"))[x.index].slice(x.start,x.start+20000),'+json.dumps(dict(index=image['index'],start=start))+')}));'
                            output=cli('own-chrome','run','--script',command)
                            chunks.append(next(json.loads(l)['chunk'] for l in output.splitlines() if l.startswith('{"chunk":')))
                        target=out / f"{label}-cast-{image['index']}.jpg"
                        target.write_bytes(base64.b64decode(''.join(chunks)))
                        local_images.append(str(target))
                    value['result']['frameImages'] = local_images
                return value['result']
        except ValueError:
            pass
    raise RuntimeError('No result in ' + label)

def save():
    results['outcome'] = ('pass' if len(rows) == (2 if args.preflight else 18) and not results.get('error') and results.get('settingsRestored') is True and all(r['status'] in ['pass', 'skip'] for r in rows) else 'fail') if results.get('finished') else 'running'
    (out / 'results.json').write_text(json.dumps(results, indent=2))

def row(width, scenario, data, ok, **extra):
    rows.append(dict(width=width, scenario=scenario, status='pass' if ok else 'fail', data=data, **extra))
    save()

def position_ok(d):
    return d['final']['offset'] is not None and abs(d['final']['offset'] - d['expected']['offset']) <= 8

def post(label):
    raw = cli('thread', 'tell', 'thr_yaa3n3kk73', 'LONG scroll matrix ' + label)
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
            row(width,4,d,position_ok(d) and not d['bottomFlashFrames'] and d['settlingMs']<=150)
            continue
        before = run(width+'-reload-before', 'console.log(JSON.stringify({result:await middle()}));')
        data = run(width+'-reload', 'console.log(JSON.stringify({result:await measure("reload",'+json.dumps(before)+')}));')
        row(width, 4, data, position_ok(data))
        two = run(width+'-two', 'const a=await middle();const b=await middle("thr_wfhsqd493j");await route("/projects/proj_jfxygzbhcr/threads/"+thread);await pause(1300);const aa=await state(thread,a.seq);await route("/projects/proj_jfxygzbhcr/threads/thr_wfhsqd493j");await pause(1300);const bb=await state("thr_wfhsqd493j",b.seq);console.log(JSON.stringify({result:{a,b,aa,bb}}));')
        row(width, 5, two, all(two[k+'a' if k=='a' else 'bb']['offset'] is not None for k in ['a','b']) and abs(two['a']['offset']-two['aa']['offset'])<=8 and abs(two['b']['offset']-two['bb']['offset'])<=8)
        action = run(width+'-action', 'await middle();await away();await p.goBack();await p.waitForFunction(()=>document.querySelector(".thread-scrollbar"));const s=await state();await p.mouse.move(s.rect.x,s.rect.y);await p.mouse.wheel({deltaY:300});await pause(300);const a=await state();await pause(1600);const b=await state(thread,a.seq);console.log(JSON.stringify({result:{a,b}}));')
        row(width, 6, action, action['b']['offset'] is not None and abs(action['a']['offset']-action['b']['offset'])<=8)
        timings = {}
        for mode in [False, True]:
            setting(mode)
            timings[str(mode)] = {}
            for action in ['return', 'reload', 'resume']:
                setup = 'const a=await middle();'
                if action=='return':
                    setup += 'await away();'
                if action=='resume':
                    setup += "await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});await pause(500);"
                before = run(width+'-flicker-'+str(mode)+'-'+action+'-before', setup+'console.log(JSON.stringify({result:a}));')
                timings[str(mode)][action] = run(width+'-flicker-'+str(mode)+'-'+action, 'console.log(JSON.stringify({result:await measure('+json.dumps(action)+','+json.dumps(before)+')}));')
        first = lambda d: next((x['ms'] for x in d['frames'] if x['painted']), None)
        comparisons = {}
        for action in ['return', 'reload', 'resume']:
            off, on = first(timings['False'][action]), first(timings['True'][action])
            data = timings['True'][action]
            wrong = [f for f in data['frames'] if f['painted'] and f['bottomGap'] is not None and f['bottomGap']<=24 and data['expected']['bottomGap']>40]
            shifted = [f for f in data['frames'] if f['painted'] and (f['offset'] is None or abs(f['offset']-data['expected']['offset'])>8)]
            settling = max((f['ms'] for f in shifted), default=on or 0)-(on or 0)
            comparisons[action] = dict(offMs=off,onMs=on,extraMs=None if off is None or on is None else on-off,bottomFlashFrames=len(wrong),settlingMs=settling,wrongPositionFrames=len(shifted))
        row(width, 7, comparisons, all(d['extraMs'] is not None and d['extraMs']<=150 and not d['bottomFlashFrames'] and d['settlingMs']<=150 for d in comparisons.values()))
        setting(False)
        off = run(width+'-switch-off', 'const a=await middle();const cache=a.cache;const d=await measure("reload",a);console.log(JSON.stringify({result:{cache,after:d.final.cache,bottomGap:d.final.bottomGap,frames:d.frames}}));')
        row(width, 8, off, off['cache']==off['after'] and off['bottomGap'] is not None and off['bottomGap']<=24)
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
