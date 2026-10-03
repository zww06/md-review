# md-review

Review project Markdown, leave precise feedback, and see what changed after a revision.

## The problem

AI-assisted development produces plans, research notes, proposals, and handoffs faster than a developer can carefully review them. Long Markdown files mean repeated scrolling, copying passages into feedback, and rereading revisions to work out what changed. The review itself becomes a bottleneck.

## What md-review does

md-review opens a workspace as a browser-based reading desk. It turns Markdown into sections you can navigate, annotate, and compare with Git history.

- Browse workspace Markdown files and read one section at a time, with an outline and folding subsections.
- Switch between rendered Markdown and line-numbered source.
- Select passages and attach comments, then edit, resolve, reopen, or delete them.
- Build an editable feedback prompt from selected comments, including their file, section, quote, and source location.
- View Git changes in the reader or in a dedicated Changes view, using a saved reviewed commit as the baseline.

Comments and reviewed commits persist between runs. Review metadata lives outside the workspace under `%LOCALAPPDATA%\md-review\`; source Markdown and Git state remain unchanged.

## Install and start

On Windows, install Node.js 22 or newer, npm, and Git. From the md-review project directory, run:

```powershell
npm install
npm run link-cli
```

This builds the app and makes the `md-review` command available for your current Node.js installation. Launch it from the workspace you want to review:

```powershell
cd D:\path\to\workspace
md-review .
```

Open the printed browser URL, normally `http://127.0.0.1:4173`. Keep the terminal running and stop the server with `Ctrl+C` when finished. To choose another port, run `md-review . --port 43173`.

You can also build and run from the md-review project directory without linking the command:

```powershell
npm run build
npm start -- D:\path\to\workspace
```

## Review a document

1. Choose a Markdown file from the sidebar. Use the outline, folds, and previous/next controls to move through its sections. Open **Source** to inspect the original wording and line numbers.
2. Select a passage and save a comment. Use the comments panel to edit comments or mark concerns resolved.
3. Choose the comments to include in feedback, add an overall instruction, edit the preview, and copy it into your development workflow.
4. Revise and commit the document in your editor, then choose **Reload files/content** to load the updated version.
5. Open **Changes** to compare the loaded document with its saved reviewed commit. Before you save a baseline, comparison uses the latest commit. Added and deleted content also appears in the rendered reader.
6. Choose **Mark reviewed** when the loaded document matches the file on disk and its current Git commit. That commit becomes the baseline for your next review.

## Development

After changing the app, rebuild with `npm run build`. Run the project checks with:

```powershell
npm run check
npm test
```
