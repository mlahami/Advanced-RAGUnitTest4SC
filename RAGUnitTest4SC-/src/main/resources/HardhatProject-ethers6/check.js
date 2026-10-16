// check.js
const fs = require('fs');
const parser = require('@babel/parser');
const filePath = process.argv[2];

if (!filePath) {
    console.error(JSON.stringify({
        error: '❌ Please provide a path to a JavaScript file.',
        usage: 'node check.js test.js'
    }));
    process.exit(1);
}

const code = fs.readFileSync(filePath, 'utf8');
const totalLinesOfCode = code.split('\n').length;

try {
    const ast = parser.parse(code, {
        sourceType: 'module',
        errorRecovery: true,
    });

    if (ast.errors && ast.errors.length > 0) {
        const totalErrors = ast.errors.length;
        const validationMetric = (1 - totalErrors / totalLinesOfCode) * 100;

        console.log(JSON.stringify({
            valid: false,
            totalErrors,
            totalLinesOfCode,
            syntaxValidationMetric: validationMetric.toFixed(2),
            errors: ast.errors.map((err, index) => ({
                index: index + 1,
                message: err.message,
                loc: err.loc
            }))
        }));
    } else {
        console.log(JSON.stringify({
            valid: true,
            totalErrors: 0,
            totalLinesOfCode,
            syntaxValidationMetric: 100.0,
            errors: []
        }));
    }
} catch (error) {
    console.log(JSON.stringify({
        valid: false,
        error: 'Critical parsing failure',
        message: error.message,
        totalErrors: totalLinesOfCode,
        totalLinesOfCode,
        syntaxValidationMetric: 0.0
    }));
}


