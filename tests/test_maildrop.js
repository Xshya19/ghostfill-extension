fetch('https://api.maildrop.cc/graphql', {
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
          data
          html
        }
      }
    `,
    variables: { mailbox: 'test', id: 'random' },
  }),
})
  .then(async (r) => {
    console.log(r.status);
    const data = await r.json();
    console.log(JSON.stringify(data, null, 2));
  })
  .catch(console.error);
