# VERA Research Capture

## Connect Chrome

1. Start your Research server. For local use, start the managed Research app. For a shared server, use its HTTPS address and your own registered VERA account.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this directory. Pin **VERA Research Capture** in the Chrome toolbar.
3. In the extension’s **Options**, enter the VERA address and select **Connect to VERA**. Allow access to that server when Chrome asks.
4. Enter the eight-digit code from Options in the VERA approval window. Check the account name and choose **Connect extension**. You can close every VERA tab once connected.

You can save to projects where your account has write access. The server must be reachable. The connection lasts 30 days. Choose **Disconnect this extension** in Options to revoke it sooner. If you lose access to the installed extension, sign in to your Research server and open `/?chrome-connections` to disconnect all extensions for your account.

## Capture

| While browsing                          | Action                                                                                                                                   | What you can save                                                                                                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Select text on an article               | Choose **Log selected quote** in the toolbar, use the selection’s VERA context menu, or use the Log quote shortcut configured in Chrome. | Review the exact text, pictures and destination. Add an optional speaker, title, Topics and note. A second quote from the same article joins its existing source.       |
| Browse a web page                       | Choose **Save current page**.                                                                                                            | Save the page details, readable article text when available, and the top and current views.                                                                             |
| Right-click an image                    | Choose **Save image as still in VERA**.                                                                                                  | Keep a copy with the page URL and available credit and alt text. If the browser cannot supply the image, the extension reports the failure.                             |
| Right-click an audio or video file link | Choose **Save audio in VERA**.                                                                                                           | Register the linked file as an audio source in the chosen project.                                                                                                      |
| Watch a YouTube video                   | Choose **Send YouTube video** or its VERA context menu action.                                                                           | Queue the video for transcription. Add a comment about what to look for. If the player position is available, check **Include** beside the displayed time to attach it. |

The confirmation window shows the destination project before you save. **Cancel** discards the capture. Keep the source tab active until confirmation opens so Chrome can capture the intended views.

Submitting the same video again gives you a fresh comment field. In the same project, each deliberate save can add a separate comment or timestamp to the same source. Open the batch in Research or look under **Ready for review** to see the comments together with their authors. Research keeps a checked playback position as elapsed milliseconds on that source comment. You can save a position by itself, including 0:00.

If Chrome cannot capture a picture, the confirmation shows which view is missing. After saving, keep the picture repair code. Capture the same page or exact quote again, choose the original project, and enter the code under **Add missing pictures to an earlier save**. Research adds the available pictures to the original item.

Pictures reflect what Chrome can display in the active tab. Review their previews before saving. For a PDF, use Research’s PDF workflow.
