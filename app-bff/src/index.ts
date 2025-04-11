// A sample TypeScript function
function greet(name: string): string {
	const a = JSON.parse(name) as any;
	console.log(a);
	return `Hello, ${name}!`;
}


console.log(greet("World"));
