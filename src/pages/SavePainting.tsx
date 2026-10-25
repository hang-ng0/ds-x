import {useParams} from 'react-router';
import {useEffect, useState} from 'react';

export default function SavePainting() {
    // Destructure the "id" parameter from the URL
    const { id } = useParams();
    const [painting, setPainting] = useState(null);

    useEffect(() => {
        // Fetch data whenever the dynamic ID changes
        fetch(`https://example.com{id}`)
            .then((res) => res.json())
            .then((data) => setPainting(data));
    }, [id]); // Add id to the dependency array

    if (!painting) return <p>Loading product details...</p>;

    return(
        <>
            {/*<h2>{painting.name}</h2>*/}
            {/*<p>{painting.description}</p>*/}
        </>
    )
}