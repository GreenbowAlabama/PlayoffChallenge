import os
import re

replacements = [
    (r'\.can_join', '.canJoin'),
    (r'\.can_edit_entry', '.canEditEntry'),
    (r'\.is_live', '.isLive'),
    (r'\.is_closed', '.isClosed'),
    (r'\.is_scoring', '.isScoring'),
    (r'\.is_scored', '.isScored'),
    (r'\.is_read_only', '.isReadOnly'),
    (r'\.can_share_invite', '.canShareInvite'),
    (r'\.can_manage_contest', '.canManageContest'),
    (r'\.can_delete', '.canDelete'),
    (r'\.can_unjoin', '.canUnjoin'),
]

test_dir = "core/Tests/coreTests/"
for filename in os.listdir(test_dir):
    if filename.endswith(".swift"):
        path = os.path.join(test_dir, filename)
        with open(path, "r") as f:
            content = f.read()
        
        orig_content = content
        for pattern, replacement in replacements:
            content = re.sub(pattern, replacement, content)
        
        if content != orig_content:
            with open(path, "w") as f:
                f.write(content)
            print(f"Updated {filename}")

