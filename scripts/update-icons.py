#!/usr/bin/env python3
"""Rebuild the Material Symbols font link in index.html so it includes exactly the icons the app uses.

Google Fonts can subset the icon font with `icon_names=`; this scans the source for
`mi('name')` calls and `<span class="mi ...">name</span>` markup (plus a few icons built
dynamically) and rewrites the <link>. Run it after adding new icons:  python3 scripts/update-icons.py
"""
import glob, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Icons whose names are assembled at runtime and so can't be found by scanning.
DYNAMIC = {
    'turn_left', 'turn_right', 'turn_slight_left', 'turn_slight_right', 'turn_sharp_left', 'turn_sharp_right', 'u_turn_left',
    'straight', 'roundabout_left', 'roundabout_right', 'merge', 'fork_left', 'fork_right', 'ramp_left', 'ramp_right',
    'clear_night', 'partly_cloudy_night', 'thermostat', 'fullscreen_exit', 'road', 'pause', 'volume_off', 'volume_up',
    # My Maps pin icons
    'location_on', 'star', 'favorite', 'home', 'work', 'restaurant', 'local_cafe', 'hotel', 'park', 'flag', 'photo_camera',
    'directions_car', 'luggage', 'bookmark', 'visibility', 'visibility_off',
}

names = set(DYNAMIC)
for path in glob.glob(os.path.join(ROOT, '*.js')) + [os.path.join(ROOT, 'index.html')]:
    src = open(path, encoding='utf-8').read()
    names |= set(re.findall(r"mi\(\s*'([a-z0-9_]+)'", src))
    names |= set(re.findall(r'class="mi[^"]*">([a-z0-9_]+)<', src))
    # Icon tables: ['icon', 'group'] (category icons), ['icon', 'Label'] (weather), [key, 'Label', 'icon'] (options)
    names |= set(re.findall(r"\[\s*'([a-z0-9_]+)',\s*'(?:food|lodging|service|shop|health|edu|nature|culture|fun|transit|place)'\]", src))
    names |= set(re.findall(r"\[\s*'([a-z0-9_]+)',\s*'[A-Z][^']*'\]", src))
    names |= set(re.findall(r"\['[a-z]+', '[A-Z][a-z ]+', '([a-z0-9_]+)'\]", src))
    names |= set(re.findall(r"icon:\s*'([a-z0-9_]+)'", src))

names = sorted(n for n in names if re.fullmatch(r'[a-z0-9_]+', n))
url = ('https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0..1,0'
       f'&icon_names={",".join(names)}&display=block')
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 Chrome/140'})
assert urllib.request.urlopen(req, timeout=30).status == 200, 'Google Fonts rejected the icon list'

html_path = os.path.join(ROOT, 'index.html')
html = open(html_path, encoding='utf-8').read()
html = re.sub(r'href="https://fonts\.googleapis\.com/css2\?family=Material\+Symbols[^"]*"', 'href="' + url.replace('&', '&amp;') + '"', html)
open(html_path, 'w', encoding='utf-8').write(html)
print(f'{len(names)} icons')
