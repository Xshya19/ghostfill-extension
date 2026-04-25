fetch('https://api.maildrop.cc/graphql', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-apollo-operation-name': 'GhostFillQuery',
    'apollo-require-preflight': 'true',
  },
  body: JSON.stringify({
    query: `
      query GetInbox($mailbox: String!) {
        inbox(mailbox: $mailbox) {
          id
          subject
        }
      }
    `,
    variables: { mailbox: 'test' },
  }),
})
  .then(async (r) => {
    console.log(r.status);
    const data = await r.json();
    console.log(JSON.stringify(data, null, 2));

    // Now try fetching the first message
    if (data.data?.inbox?.[0]?.id) {
      const id = data.data.inbox[0].id;
      console.log('Fetching message', id);
      const msgRes = await fetch('https://api.maildrop.cc/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-apollo-operation-name': 'GhostFillQuery',
          'apollo-require-preflight': 'true',
        },
        body: JSON.stringify({
          query: `
          query GetMsg($mailbox: String!, $id: String!) {
            message(mailbox: $mailbox, id: $id) {
              id
              subject
              html
              data
            }
          }
        `,
          variables: { mailbox: 'test', id: id },
        }),
      });

      const msgData = await msgRes.json();
      console.log('Msg response:', JSON.stringify(msgData, null, 2));
    }
  })
  .catch(console.error);
