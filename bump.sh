#!/usr/bin/env bash
# الاستخدام: ./bump.sh "ملاحظة 1" "ملاحظة 2"
set -e
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('version.json'))['v']+1)")
python3 - "$V" "$@" <<'PY'
import json,sys,re
v=int(sys.argv[1]); notes=sys.argv[2:]
json.dump({"v":v,"notes":notes},open('version.json','w'),ensure_ascii=False)
s=open('index.html',encoding='utf-8').read(); s=re.sub(r'const APP_V = \d+;',f'const APP_V = {v};',s,1); open('index.html','w',encoding='utf-8').write(s)
w=open('sw.js').read(); w=re.sub(r"grades-v\d+",f"grades-v{v}",w,1); open('sw.js','w').write(w)
PY
echo "v$V"
