---
"@chatcops/widget": minor
"@chatcops/server": minor
"@chatcops/core": minor
---

`ChatCops.setUser({ name, email, token })` and `ChatCops.setContext(data)`. `setUser` sets the signed-in visitor's identity token for the server, and sends `name` and `email` as visitor details with the first message of each conversation; switching users or `setUser(null)` clears the chat. `setContext` adds details for the next messages, such as `{ plan: 'Team' }`, sent as the new `pageContext.data` (at most 20 string fields), which the server shows the model as page details that aren't verified. With the script tag loader both are kept until the chat loads, without loading it early or touching storage.

Visitor details are now sent again with the first message of a new conversation on a v1 server, which keeps them from that message.
