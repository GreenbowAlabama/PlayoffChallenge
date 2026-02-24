#!/bin/bash

# Get all picks with NULL position and delete them via API
curl -s "https://playoffchallenge-production.up.railway.app/api/leaderboard?weekNumber=13&includePicks=true" | \
python3 -c "
import sys, json, subprocess

data = json.load(sys.stdin)

null_pick_ids = []
for user in data:
    picks = user.get('picks', [])
    for pick in picks:
        if pick.get('position') is None:
            pick_id = pick.get('pick_id')
            if pick_id:
                null_pick_ids.append(pick_id)

print(f'Found {len(null_pick_ids)} picks with NULL position\n')

deleted_count = 0
for pick_id in null_pick_ids:
    try:
        result = subprocess.run(
            ['curl', '-s', '-X', 'DELETE',
             f'https://playoffchallenge-production.up.railway.app/api/picks/{pick_id}'],
            capture_output=True,
            text=True,
            timeout=10
        )
        if 'success' in result.stdout.lower():
            deleted_count += 1
            print(f'Deleted pick {pick_id}')
    except Exception as e:
        print(f'Error deleting {pick_id}: {e}')

print(f'\nDeleted {deleted_count} of {len(null_pick_ids)} picks')
"
