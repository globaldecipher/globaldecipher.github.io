# Publish TGD at globaldecipher.github.io

This project is ready for free GitHub Pages hosting.

## The important rule

To get this exact free address:

```text
https://globaldecipher.github.io
```

the GitHub username or organization must be:

```text
globaldecipher
```

and the repository must be named:

```text
globaldecipher.github.io
```

If the GitHub account is named something else, the free address changes. For example, account `tgdintel` would use `https://tgdintel.github.io`.

## Option A: Upload through the GitHub website

1. Create or sign in to GitHub.
2. Create a public repository named `globaldecipher.github.io`.
3. Upload all project files from this folder, including:
   - `.github`
   - `content`
   - `static`
   - `build.mjs`
   - `README.md`
   - `package.json`
4. Open the repository on GitHub.
5. Go to `Settings` > `Pages`.
6. Under `Build and deployment`, choose `GitHub Actions`.
7. Go to the `Actions` tab.
8. Wait for `Publish TGD site to GitHub Pages` to finish.
9. Open `https://globaldecipher.github.io`.

## Option B: Upload only the finished site

This is simpler but less powerful.

1. Create a public repository named `globaldecipher.github.io`.
2. Upload only the contents of the `site` folder.
3. Go to `Settings` > `Pages`.
4. Choose `Deploy from a branch`.
5. Choose branch `main` and folder `/root`.

Use Option A if you want future article publishing to be easier.

## Updating the website later

1. Add or edit Markdown files in `content`.
2. Upload/push the changed files to GitHub.
3. GitHub Actions rebuilds and republishes the website automatically.
