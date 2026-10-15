const { Generator, getConfig } = require('@tanstack/router-generator');

async function run() {
  try {
    const config = await getConfig();
    const generator = new Generator({
      config,
      root: process.cwd(),
    });
    await generator.run();
    console.log('Successfully generated routeTree.gen.ts!');
  } catch (err) {
    console.error('Error generating route tree:', err);
  }
}

run();
