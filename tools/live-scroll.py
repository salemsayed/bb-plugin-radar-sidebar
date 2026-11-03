#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--natural-wait', type=int, default=600)
args = parser.parse_args()
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=True)
helper = Path(__file__).with_name('live-scroll-browser.js').read_text()
rows = []
results = {'rows': rows, 'postPolicy': 'Each width is one round with at most three LONG posts, one each for return, bottom and background.', 'limitations': ['Phone is real Chrome mobile emulation, not native iOS. Background uses the visibility/focus event route.']}

def cli(*cmd):
    return subprocess.check_output(['bb', *cmd], text=True)

def run(label, body):
    script = out / (label + '.js')
    script.write_text(helper + '\n' + body)
    raw = cli('own-chrome', 'run', '--timeout', '90s', '--script-file', str(script))
    (out / (label + '.log')).write_text(raw)
    for n, path in enumerate(re.findall(r'^  (/.+\.jpg)$', raw, re.M)):
        shutil.copy2(path, out / f'{label}-{n}.jpg')
    for line in reversed(raw.splitlines()):
        try:
            value = json.loads(line)
            if isinstance(value, dict) and 'result' in value:
                return value['result']
        except ValueError:
            pass
    raise RuntimeError('No result in ' + label)

def save():
    results['outcome'] = 'pass' if len(rows) == 18 and all(r['status'] in ['pass', 'skip'] for r in rows) else 'fail'
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

original = json.loads(cli('plugin', 'config', 'radar-sidebar', '--json'))['values']
results['originalSettings'] = original
results['installed'] = json.loads(cli('plugin', 'list', '--json'))
try:
    for width, viewport in [('phone', dict(width=390, height=844, isMobile=True, hasTouch=True)), ('desktop', dict(width=1280, height=900, isMobile=False, hasTouch=False))]:
        run(width+'-viewport', 'await p.setViewport('+json.dumps(viewport)+'); console.log(JSON.stringify({result:{ok:true}}));')
        setting(True)
        for scenario, phase in [(1, 'return'), (2, 'bottom'), (3, 'background')]:
            before = run(width+'-'+phase+'-before', "const before=await middle();" + ("await p.evaluate(()=>{const b=document.querySelector('.thread-scrollbar');b.scrollTop=b.scrollHeight;});await pause(700);" if scenario == 2 else '') + ("await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});" if scenario == 3 else 'await away();') + 'console.log(JSON.stringify({result:before}));')
            post(width+'-'+phase)
            data = run(width+'-'+phase+'-after', 'console.log(JSON.stringify({result:await measure('+json.dumps('resume' if scenario == 3 else 'return')+','+json.dumps(before)+')}));')
            row(width, scenario, data, data['final']['bottomGap'] <= 24 if scenario == 2 else position_ok(data))
        before = run(width+'-reload-before', 'console.log(JSON.stringify({result:await middle()}));')
        data = run(width+'-reload', 'console.log(JSON.stringify({result:await measure("reload",'+json.dumps(before)+')}));')
        row(width, 4, data, position_ok(data))
        two = run(width+'-two', 'const a=await middle();const b=await middle("thr_wfhsqd493j");await route("/threads/"+thread);await pause(1300);const aa=await state(thread,a.seq);await route("/threads/thr_wfhsqd493j");await pause(1300);const bb=await state("thr_wfhsqd493j",b.seq);console.log(JSON.stringify({result:{a,b,aa,bb}}));')
        row(width, 5, two, all(two[k+'a' if k=='a' else 'bb']['offset'] is not None for k in ['a','b']) and abs(two['a']['offset']-two['aa']['offset'])<=8 and abs(two['b']['offset']-two['bb']['offset'])<=8)
        action = run(width+'-action', 'await middle();await away();await p.goBack();await p.waitForFunction(()=>document.querySelector(".thread-scrollbar"));const s=await state();await p.mouse.move(s.rect.x,s.rect.y);await p.mouse.wheel({deltaY:300});await pause(300);const a=await state();await pause(1600);const b=await state(thread,a.seq);console.log(JSON.stringify({result:{a,b}}));')
        row(width, 6, action, action['b']['offset'] is not None and abs(action['a']['offset']-action['b']['offset'])<=8)
        timings = {}
        for mode in [False, True]:
            setting(mode)
            before = run(width+'-flicker-'+str(mode)+'-before', 'const a=await middle();await away();console.log(JSON.stringify({result:a}));')
            timings[str(mode)] = run(width+'-flicker-'+str(mode), 'console.log(JSON.stringify({result:await measure("return",'+json.dumps(before)+')}));')
        first = lambda d: next((x['ms'] for x in d['frames'] if x['painted']), None)
        off, on = first(timings['False']), first(timings['True'])
        wrong = [f for f in timings['True']['frames'] if f['painted'] and (f['offset'] is None or abs(f['offset']-timings['True']['expected']['offset'])>8)]
        row(width, 7, dict(offMs=off,onMs=on,extraMs=None if off is None or on is None else on-off,wrongFrames=len(wrong)), off is not None and on is not None and on-off<=150 and not wrong)
        setting(False)
        off = run(width+'-switch-off', 'const a=await middle();const cache=a.cache;await away();await measure("return",a);console.log(JSON.stringify({result:{cache,after:(await state()).cache}}));')
        row(width, 8, off, off['cache']==off['after'])
        setting(True)
        natural = run(width+'-natural-before', 'console.log(JSON.stringify({result:await middle("thr_exqyeqrqpy")}));')
        started = time.monotonic()
        initial = cli('thread','log','thr_exqyeqrqpy','--format','minimal','--limit','1')
        run(width+'-natural-away', 'await away();console.log(JSON.stringify({result:{ok:true}}));')
        observed = False
        while time.monotonic()-started < args.natural_wait:
            time.sleep(min(30, args.natural_wait))
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
    save()
print(out/'results.json')
raise SystemExit(0 if results['outcome']=='pass' else 1)
