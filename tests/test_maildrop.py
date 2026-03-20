import urllib.request, json
try:
    req = urllib.request.Request(
        'https://api.maildrop.cc/graphql', 
        data=json.dumps({
            'query':'query(!,!){message(mailbox:,id:){id html text subject}}', 
            'variables':{'mailbox':'test', 'id':'random'}
        }).encode(), 
        headers={'Content-Type':'application/json', 'x-apollo-operation-name':'GhostFillQuery', 'apollo-require-preflight':'true'}
    )
    print(urllib.request.urlopen(req).read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
